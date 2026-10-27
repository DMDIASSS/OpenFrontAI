"""Synchronous local subprocess adapter for real headless OpenFront self-play."""
import atexit
from dataclasses import asdict
import json
import os
from pathlib import Path
import subprocess

import numpy as np

from .sim import TerritorySim

PROJECT = Path(__file__).resolve().parents[1]


class RealEngineSim:
    fractions = TerritorySim.fractions
    baseline = TerritorySim.baseline

    def __init__(self, config):
        if config.players != 4 or config.size != 100:
            raise ValueError("Real engine currently supports 4 players on the 100x100 plains map")
        self.config = config
        self.n, self.p, self.tiles, self.actions = config.envs, 4, 10000, 18
        self.rng = np.random.default_rng(config.seed)
        root = Path(os.environ.get("OPENFRONT_SOURCE", PROJECT / "vendor/openfrontio"))
        tsx = root / "node_modules/tsx/dist/cli.mjs"
        if not tsx.exists():
            raise FileNotFoundError("Run bash scripts/setup_engine.sh to install the pinned engine")
        self.process = subprocess.Popen(["node", str(tsx), str(PROJECT / "scripts/engine_worker.mts")],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                                        encoding="utf-8", bufsize=1)
        atexit.register(self.close)
        self._request({"op": "init", "config": asdict(config)})

    def _request(self, data):
        if self.process.poll() is not None:
            raise RuntimeError(f"Engine worker exited with code {self.process.returncode}")
        self.process.stdin.write(json.dumps(data) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("Engine worker closed its output; inspect stderr")
        response = json.loads(line)
        if "error" in response:
            raise RuntimeError(response["error"])
        observations = response["observations"]
        self._observation = (np.array([o["x"] for o in observations], np.float32),
                             np.array([o["mask"] for o in observations], bool),
                             np.array([o["utility"] for o in observations], np.float32))
        return response

    def observe(self):
        return self._observation

    def reset(self, indices=None):
        ix = np.arange(self.n) if indices is None else np.asarray(indices)
        if len(ix):
            self._request({"op": "reset", "indices": ix.tolist()})

    def step(self, actions):
        actions = np.asarray(actions)
        if actions.shape != (self.n, self.p) or not np.issubdtype(actions.dtype, np.integer):
            raise ValueError("Expected integer action array [env, player]")
        if np.any((actions < 0) | (actions >= self.actions)):
            raise ValueError("Action outside candidate space")
        rows = self._request({"op": "step", "actions": actions.tolist()})["transitions"]
        info = {k: np.array([r[k] for r in rows]) for k in
                ("land", "winner", "score", "win_credit", "steps", "max_land", "troops")}
        return (np.array([r["reward"] for r in rows], np.float32),
                np.array([r["done"] for r in rows], bool), info)

    def close(self):
        if getattr(self, "process", None) is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None
            atexit.unregister(self.close)


def make_sim(config, backend="surrogate"):
    if backend == "surrogate":
        return TerritorySim(config)
    if backend == "engine":
        return RealEngineSim(config)
    raise ValueError(f"Unknown backend {backend}")
