import json
from pathlib import Path

import torch
from torch import nn
from torch.distributions import Categorical

from .features import ARCHES, INPUTS


class BranchActor(nn.Module):
    def __init__(self, hidden=40):
        super().__init__()
        if hidden not in ARCHES.values():
            raise ValueError("The extension supports hidden widths 24 or 40")
        self.hidden = hidden
        self.first = nn.Linear(INPUTS, hidden)
        self.last = nn.Linear(hidden, 1)
        nn.init.orthogonal_(self.first.weight)
        nn.init.zeros_(self.first.bias)
        nn.init.orthogonal_(self.last.weight, .01)
        nn.init.zeros_(self.last.bias)

    def forward(self, x):
        # Same two tanh transforms and weight ordering as shadowV7.predict.
        return (torch.tanh(self.last(torch.tanh(self.first(x)))).squeeze(-1) + 1) / 2

    def distribution(self, x, mask):
        return Categorical(logits=(self(x) * 8).masked_fill(~mask, -1e9))

    def export(self, path, domain="surrogate"):
        weights = torch.cat((self.first.weight.T.flatten(), self.first.bias,
                             self.last.weight.T.flatten(), self.last.bias)).detach().cpu()
        if not torch.isfinite(weights).all() or weights.abs().max() > 5:
            raise ValueError("Model violates the extension's finite |weight|<=5 contract")
        data = {"schema": 7, "arch": f"38x{self.hidden}x2-tanh",
                "outputs": ["branchScore"], "weights": weights.tolist(),
                "training_domain": "OpenFront headless engine plains v1" if domain == "engine" else "OpenFrontAI macro-tile surrogate v1",
                "supported_kinds": ["wait", "expand", "attack"] + ([] if domain == "engine" else ["build_economy"]),
                "real_game_strength": "unvalidated"}
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, allow_nan=False) + "\n")
        return data


class ActorCritic(nn.Module):
    def __init__(self, hidden=40):
        super().__init__()
        self.actor = BranchActor(hidden)
        self.critic = nn.Sequential(nn.Linear(INPUTS, 64), nn.Tanh(), nn.Linear(64, 1))

    def value(self, x, mask):
        pooled = (x * mask[..., None]).sum(-2) / mask.sum(-1, keepdim=True).clamp_min(1)
        return self.critic(pooled).squeeze(-1)

    def act(self, x, mask):
        dist = self.actor.distribution(x, mask)
        action = dist.sample()
        return action, dist.log_prob(action), self.value(x, mask)


def load_actor(path, device="cpu"):
    """Load inference weights without starting training worlds or restoring RNGs."""
    data = torch.load(path, map_location="cpu", weights_only=True)
    if data.get("format") != 1:
        raise ValueError("Unsupported checkpoint version")
    actor = BranchActor(data["train_config"]["hidden"]).to(device)
    actor.load_state_dict({k[len("actor."):]: v for k, v in data["model"].items() if k.startswith("actor.")})
    return actor.eval(), data
