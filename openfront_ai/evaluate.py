from dataclasses import asdict
import math
import time

import numpy as np
import torch

from .sim import SimConfig, TerritorySim
from .engine import make_sim


def wilson(wins, games):
    z = 1.96
    p = wins / games
    denominator = 1 + z*z/games
    center = (p + z*z/(2*games)) / denominator
    radius = z * math.sqrt(p*(1-p)/games + z*z/(4*games*games)) / denominator
    return [max(0., center-radius), min(1., center+radius)]


def evaluate(actor=None, *, games=64, seed=10001, opponent="heuristic", learner="neural",
             size=10, max_steps=160, players=4, device="cpu", backend="surrogate"):
    config = SimConfig(envs=games, seed=seed, size=size, max_steps=max_steps, players=players)
    sim = make_sim(config, backend)
    active = np.ones(games, bool)
    outcomes = []
    start = time.perf_counter()
    for _ in range(max_steps):
        observation = sim.observe()
        actions = sim.baseline(opponent, observation)
        if learner == "neural":
            if actor is None:
                raise ValueError("A neural learner needs a policy")
            with torch.no_grad():
                x = torch.as_tensor(observation[0][:, 0], device=device)
                mask = torch.as_tensor(observation[1][:, 0], device=device)
                # Greedy evaluation matches userscript argmax deployment.
                actions[:, 0] = actor(x).masked_fill(~mask, -torch.inf).argmax(-1).cpu().numpy()
        else:
            actions[:, 0] = sim.baseline(learner, observation)[:, 0]
        actions[~active] = 0
        _, done, info = sim.step(actions)
        for i in np.flatnonzero(done & active):
            outcomes.append({"win_credit": float(info["win_credit"][i]),
                             "outright_win": bool(info["score"][i, 0] > info["score"][i, 1:].max()),
                             "budget_limited": bool(info["steps"][i] >= max_steps),
                             "learner_eliminated": bool(info["land"][i, 0] == 0),
                             "conquest_win": bool(info["land"][i, 0] > 0 and not info["land"][i, 1:].any()),
                             "land_share": float(info["land"][i, 0] / sim.tiles),
                             "steps": int(info["steps"][i])})
        active &= ~done
        if not active.any():
            break
    if len(outcomes) != games:
        raise RuntimeError(f"Only {len(outcomes)}/{games} games completed")
    wins = sum(o["outright_win"] for o in outcomes)
    if hasattr(sim, "close"):
        sim.close()
    return {"domain": "actual OpenFront engine, headless plains land-only adapter" if backend == "engine" else "surrogate-v1; not a real-game strength measurement", "config": asdict(config),
            "opponent": opponent, "learner": learner, "action_selection": "greedy",
            "completed_games": len(outcomes), "outright_wins": wins,
            "budget_limited_games": sum(o["budget_limited"] for o in outcomes),
            "learner_eliminated_games": sum(o["learner_eliminated"] for o in outcomes),
            "conquest_wins": sum(o["conquest_win"] for o in outcomes),
            "outright_win_rate": wins / games, "win_rate_95pct_wilson": wilson(wins, games),
            "mean_win_credit": float(np.mean([o["win_credit"] for o in outcomes])),
            "mean_land_share": float(np.mean([o["land_share"] for o in outcomes])),
            "mean_episode_steps": float(np.mean([o["steps"] for o in outcomes])),
            "elapsed_seconds": time.perf_counter() - start}
