"""Clipped PPO, GAE, checkpointed simulation/RNG, and historical self-play."""
from collections import deque
from copy import deepcopy
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import time

import numpy as np
import torch

from .model import ActorCritic, BranchActor
from .sim import SimConfig, TerritorySim
from .engine import make_sim


@dataclass(frozen=True)
class TrainConfig:
    horizon: int = 64
    epochs: int = 4
    minibatch: int = 512
    learning_rate: float = 3e-4
    gamma: float = .99
    gae_lambda: float = .95
    entropy: float = .015
    clip: float = .2
    hidden: int = 40
    snapshot_every: int = 5
    league_size: int = 8

    def __post_init__(self):
        if min(self.horizon, self.epochs, self.minibatch, self.snapshot_every, self.league_size) < 1:
            raise ValueError("Training sizes and intervals must be positive")
        if self.learning_rate <= 0 or not 0 < self.gamma < 1 or not 0 <= self.gae_lambda <= 1:
            raise ValueError("Invalid optimizer or discount configuration")


def advantages(rewards, dones, values, last_value, gamma=.99, lam=.95):
    adv = torch.zeros_like(rewards)
    carry = torch.zeros_like(last_value)
    for t in reversed(range(len(rewards))):
        next_value = last_value if t == len(rewards) - 1 else values[t + 1]
        live = 1 - dones[t].float()
        delta = rewards[t] + gamma * next_value * live - values[t]
        carry = delta + gamma * lam * live * carry
        adv[t] = carry
    return adv, adv + values


class Trainer:
    def __init__(self, sim_config=SimConfig(), config=TrainConfig(), device="cpu", backend="surrogate"):
        self.config, self.device = config, torch.device(device)
        torch.manual_seed(sim_config.seed)
        if self.device.type == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA was requested but PyTorch cannot access a CUDA device")
        self.rng = np.random.default_rng(sim_config.seed + 73)
        self.backend = backend
        self.sim = make_sim(sim_config, backend)
        self.model = ActorCritic(config.hidden).to(self.device)
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=config.learning_rate, eps=1e-5)
        self.league = deque(maxlen=config.league_size)
        self.league.append(deepcopy(self.model.actor).eval().requires_grad_(False))
        self.update = 0
        self.steps = 0

    def tensor(self, x):
        return torch.as_tensor(x, device=self.device)

    def warmup(self, steps=128, epochs=12):
        """Optional behavior cloning of the visible rule baseline, then PPO.

        This is a bootstrap, not self-play evidence. Only decision frames with
        at least two legal candidates contribute supervised labels.
        """
        rows, masks, labels = [], [], []
        for _ in range(steps):
            observation = self.sim.observe()
            x, mask, _ = observation
            action = self.sim.baseline("heuristic", observation)
            useful = mask.sum(-1) > 1
            rows.append(x[useful]); masks.append(mask[useful]); labels.append(action[useful])
            _, done, _ = self.sim.step(action)
            self.sim.reset(np.flatnonzero(done))
        x, mask, target = map(self.tensor, (np.concatenate(rows), np.concatenate(masks), np.concatenate(labels)))
        if len(x) == 0:
            raise RuntimeError("Warmup produced no actionable teacher frames")
        optimizer = torch.optim.Adam(self.model.actor.parameters(), lr=3e-3)
        for _ in range(epochs):
            for ix in torch.randperm(len(x), device=self.device).split(512):
                dist = self.model.actor.distribution(x[ix], mask[ix])
                loss = -dist.log_prob(target[ix]).mean()
                optimizer.zero_grad(); loss.backward(); optimizer.step()
                with torch.no_grad():
                    for param in self.model.actor.parameters(): param.clamp_(-5, 5)
        with torch.no_grad():
            prediction = self.model.actor(x).masked_fill(~mask, -torch.inf).argmax(-1)
            accuracy = (prediction == target).float().mean().item()
        self.sim.reset()
        self.league.append(deepcopy(self.model.actor).eval().requires_grad_(False))
        return {"stage": "behavior-cloning bootstrap, not self-play", "teacher_frames": len(x),
                "teacher_agreement": accuracy, "epochs": epochs}

    def collect(self):
        batch = {k: [] for k in ("x", "mask", "actions", "logp", "values", "rewards", "dones")}
        results = []
        # Assign opponent sources per world and seat; p0 always uses the learner.
        # 40% historical policy, 25% current copy, 25% heuristic, 10% random.
        sources = self.rng.choice(4, (self.sim.n, self.sim.p), p=[.4, .25, .25, .1])
        historical = self.league[int(self.rng.integers(len(self.league)))]
        for _ in range(self.config.horizon):
            observation = self.sim.observe()
            x, mask = map(self.tensor, observation[:2])
            with torch.no_grad():
                all_actions = self.model.actor.distribution(x, mask).sample()
                old_actions = historical.distribution(x, mask).sample()
                act = all_actions.cpu().numpy().copy()
                act = np.where(sources == 0, old_actions.cpu().numpy(), act)
                act = np.where(sources == 2, self.sim.baseline("heuristic", observation), act)
                act = np.where(sources == 3, self.sim.baseline("random", observation), act)
                learner, logp, value = self.model.act(x[:, 0], mask[:, 0])
                act[:, 0] = learner.cpu().numpy()
            reward, done, info = self.sim.step(act)
            for k, v in (("x", x[:, 0]), ("mask", mask[:, 0]), ("actions", learner),
                         ("logp", logp), ("values", value),
                         ("rewards", self.tensor(reward)), ("dones", self.tensor(done))):
                batch[k].append(v)
            for i in np.flatnonzero(done):
                results.append({"win_credit": float(info["win_credit"][i]),
                                "land_share": float(info["land"][i, 0] / self.sim.tiles),
                                "length": int(info["steps"][i])})
            self.sim.reset(np.flatnonzero(done))
        with torch.no_grad():
            x, mask, _ = self.sim.observe()
            last_value = self.model.value(self.tensor(x[:, 0]), self.tensor(mask[:, 0]))
        batch = {k: torch.stack(v) for k, v in batch.items()}
        adv, returns = advantages(batch["rewards"], batch["dones"], batch["values"],
                                  last_value, self.config.gamma, self.config.gae_lambda)
        batch["adv"], batch["returns"] = adv, returns
        return {k: v.flatten(0, 1) for k, v in batch.items()}, results

    def train_update(self):
        start = time.perf_counter()
        batch, episodes = self.collect()
        n = len(batch["adv"])
        batch["adv"] = (batch["adv"] - batch["adv"].mean()) / batch["adv"].std(unbiased=False).clamp_min(1e-8)
        sums = np.zeros(4)
        count = 0
        for _ in range(self.config.epochs):
            order = torch.randperm(n, device=self.device)
            for indices in order.split(self.config.minibatch):
                b = {k: v[indices] for k, v in batch.items()}
                dist = self.model.actor.distribution(b["x"], b["mask"])
                logp = dist.log_prob(b["actions"])
                ratio = (logp - b["logp"]).exp()
                pg = -torch.minimum(ratio * b["adv"], ratio.clamp(1-self.config.clip, 1+self.config.clip) * b["adv"]).mean()
                value_loss = .5 * (self.model.value(b["x"], b["mask"]) - b["returns"]).square().mean()
                entropy = dist.entropy().mean()
                loss = pg + value_loss - self.config.entropy * entropy
                if not torch.isfinite(loss):
                    raise FloatingPointError("Non-finite PPO loss")
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), .5)
                self.optimizer.step()
                with torch.no_grad():
                    for param in self.model.actor.parameters():
                        param.clamp_(-5, 5)
                approx_kl = ((ratio - 1) - (logp - b["logp"])).mean()
                sums += [pg.item(), value_loss.item(), entropy.item(), approx_kl.item()]
                count += 1
        self.update += 1
        self.steps += n
        if self.update % self.config.snapshot_every == 0:
            self.league.append(deepcopy(self.model.actor).eval().requires_grad_(False))
        metrics = dict(zip(("policy_loss", "value_loss", "entropy", "approx_kl"), (sums / count).tolist()))
        metrics.update(update=self.update, learner_steps=self.steps, episodes=len(episodes),
                       league_size=len(self.league),
                       decisions_per_second=n / (time.perf_counter() - start),
                       mean_win_credit=float(np.mean([e["win_credit"] for e in episodes])) if episodes else None,
                       mean_land_share=float(np.mean([e["land_share"] for e in episodes])) if episodes else None)
        return metrics

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        sim_arrays = {name: torch.from_numpy(getattr(self.sim, name).copy()) for name in
                      ("owner", "terrain", "troops", "gold", "cities", "factories", "prev_troops", "ticks")} if self.backend == "surrogate" else {}
        data = {"format": 1, "sim_config": asdict(self.sim.config), "train_config": asdict(self.config),
                "model": self.model.state_dict(), "optimizer": self.optimizer.state_dict(),
                "league": [actor.state_dict() for actor in self.league],
                "update": self.update, "steps": self.steps,
                "sim_arrays": sim_arrays, "sim_rng": self.sim.rng.bit_generator.state,
                "rng": self.rng.bit_generator.state, "torch_rng": torch.get_rng_state(),
                "cuda_rng": torch.cuda.get_rng_state_all() if self.device.type == "cuda" else [],
                "torch_version": str(torch.__version__)}
        data["backend"] = self.backend
        data["environment_restore"] = "exact-state" if self.backend == "surrogate" else "fresh-episodes"
        temp = path.with_suffix(".tmp")
        torch.save(data, temp)
        temp.replace(path)

    @classmethod
    def load(cls, path, device="cpu"):
        data = torch.load(path, map_location="cpu", weights_only=True)
        if data["format"] != 1:
            raise ValueError("Unsupported checkpoint version")
        obj = cls(SimConfig(**data["sim_config"]), TrainConfig(**data["train_config"]), device, data.get("backend", "surrogate"))
        obj.model.load_state_dict(data["model"])
        obj.optimizer.load_state_dict(data["optimizer"])
        obj.update, obj.steps = data["update"], data["steps"]
        for name, value in data["sim_arrays"].items():
            getattr(obj.sim, name)[:] = value.numpy()
        obj.sim.rng.bit_generator.state = data["sim_rng"]
        obj.rng.bit_generator.state = data["rng"]
        obj.league.clear()
        for state in data["league"]:
            actor = BranchActor(obj.config.hidden).to(obj.device)
            actor.load_state_dict(state)
            obj.league.append(actor.eval().requires_grad_(False))
        torch.set_rng_state(data["torch_rng"])
        if obj.device.type == "cuda" and data["cuda_rng"]:
            torch.cuda.set_rng_state_all(data["cuda_rng"])
        return obj


def train(trainer, updates, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for _ in range(updates):
        metrics = trainer.train_update()
        print(json.dumps(metrics, allow_nan=False), flush=True)
        with (out / "metrics.jsonl").open("a") as f:
            f.write(json.dumps(metrics, allow_nan=False) + "\n")
        trainer.save(out / "latest.pt")
        trainer.model.actor.export(out / "policy.json", trainer.backend)
        if trainer.update % trainer.config.snapshot_every == 0:
            trainer.save(out / f"snapshot-{trainer.update:06d}.pt")
