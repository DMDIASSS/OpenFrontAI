from pathlib import Path

import numpy as np
import pytest
import torch

from openfront_ai.engine import RealEngineSim, PROJECT
from openfront_ai.sim import SimConfig
from openfront_ai.train import TrainConfig, Trainer

pytestmark = [pytest.mark.engine, pytest.mark.skipif(
    not (PROJECT / "vendor/openfrontio/node_modules/tsx/dist/cli.mjs").exists(),
    reason="Optional pinned engine is not installed; run scripts/setup_engine.sh")]


def test_real_engine_advances_captures_and_resets():
    sim = RealEngineSim(SimConfig(envs=2, size=100, max_steps=4, seed=72))
    try:
        initial = sim.observe()[0].copy()
        for _ in range(4):
            actions = sim.baseline()
            x, mask, _ = sim.observe()
            assert x.shape == (2, 4, 18, 38)
            assert np.isfinite(x).all() and ((x >= 0) & (x <= 1)).all()
            assert np.take_along_axis(mask, actions[..., None], -1).all()
            reward, done, info = sim.step(actions)
        assert done.all() and (info["steps"] == 4).all()
        assert (info["max_land"] > 52).all()  # actual ownership grew, not just commands sent
        assert np.isfinite(reward).all()
        sim.reset([0])
        assert sim.observe()[1][0, :, 1:4].any()
        assert not sim.observe()[1][1, :, 1:].any()  # ended world stays ended
    finally:
        sim.close()


def test_real_engine_ppo_checkpoint_resumes_model_with_fresh_episodes(tmp_path):
    trainer = Trainer(SimConfig(envs=2, size=100, max_steps=4),
                      TrainConfig(horizon=4, epochs=1, minibatch=8), backend="engine")
    resumed = None
    try:
        metrics = trainer.train_update()
        assert metrics["episodes"] == 2
        checkpoint = tmp_path / "engine.pt"
        trainer.save(checkpoint)
        data = torch.load(checkpoint, weights_only=True)
        assert data["environment_restore"] == "fresh-episodes"
        resumed = Trainer.load(checkpoint)
        for a, b in zip(trainer.model.parameters(), resumed.model.parameters()):
            torch.testing.assert_close(a, b, rtol=0, atol=0)
        assert resumed.train_update()["update"] == 2
    finally:
        trainer.sim.close()
        if resumed:
            resumed.sim.close()
