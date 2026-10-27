"""Export a real match to one self-contained, offline HTML replay."""
import json
from pathlib import Path

import numpy as np
import torch

from .engine import make_sim
from .model import load_actor
from .sim import SimConfig


def encode_runs(values):
    result = []
    for value in values:
        value = int(value)
        if result and result[-2] == value:
            result[-1] += 1
        else:
            result.extend((value, 1))
    return result


def action_label(action, players):
    if action == 0:
        return "Wait / ongoing operation"
    if action <= 3:
        return f"Expand neutral land · {int([.2, .5, .8][action-1]*100)}% troops"
    if action < 4 + players * 3:
        return f"Attack P{(action-4)//3} · {int([.2, .5, .8][(action-4)%3]*100)}% troops"
    return "Build city" if action == 4 + players*3 else "Build factory"


def record(checkpoint, out, games=1, seed=50001, max_steps=160, opponent="heuristic", backend=None):
    if games < 1 or max_steps < 2:
        raise ValueError("Need games>=1 and max_steps>=2")
    actor, data = load_actor(checkpoint)
    backend = backend or data.get("backend", "surrogate")
    size = 100 if backend == "engine" else data["sim_config"]["size"]
    sim = make_sim(SimConfig(envs=1, size=size, max_steps=max_steps, seed=seed), backend)
    matches = []

    def capture(labels):
        if backend == "engine":
            frame = sim.snapshot()
        else:
            land = sim.land()[0]
            frame = {"width": size, "height": size, "ticks": int(sim.ticks[0]),
                     "step": int(sim.ticks[0]), "owner": sim.owner[0].tolist(),
                     "players": [{"id": p, "land": int(land[p]), "troops": float(sim.troops[0, p]),
                                  "gold": float(sim.gold[0, p]), "outgoing": 0} for p in range(sim.p)]}
        frame["runs"] = encode_runs(frame.pop("owner"))
        frame["actions"] = labels
        return frame

    try:
        for match in range(games):
            if match:
                sim.reset()
            frames = [capture(["Spawn"] * sim.p)]
            for _ in range(max_steps):
                observation = sim.observe()
                actions = sim.baseline(opponent, observation)
                with torch.no_grad():
                    x = torch.as_tensor(observation[0][:, 0])
                    mask = torch.as_tensor(observation[1][:, 0])
                    actions[:, 0] = actor(x).masked_fill(~mask, -torch.inf).argmax(-1).numpy()
                labels = [action_label(int(a), sim.p) for a in actions[0]]
                _, done, info = sim.step(actions)
                frames.append(capture(labels))
                if done[0]:
                    break
            outcome = ("Learner eliminated" if info["land"][0, 0] == 0 else
                       "Full conquest" if not info["land"][0, 1:].any() else "Decision budget reached")
            matches.append({"frames": frames, "outcome": outcome, "scoreWinner": int(info["winner"][0])})
    finally:
        if hasattr(sim, "close"):
            sim.close()
    payload = {"backend": backend, "checkpoint": Path(checkpoint).name, "seed": seed,
               "opponent": opponent, "matches": matches}
    template = (Path(__file__).parent / "replay.html").read_text(encoding="utf-8")
    text = template.replace("/*REPLAY_DATA*/null", json.dumps(payload, allow_nan=False).replace("<", "\\u003c"))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    return {"path": str(out.resolve()), "matches": games, "frames": sum(len(m["frames"]) for m in matches),
            "backend": backend, "outcomes": [m["outcome"] for m in matches]}
