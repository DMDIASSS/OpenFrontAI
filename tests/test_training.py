import numpy as np
import torch

from openfront_ai.model import BranchActor
from openfront_ai.sim import SimConfig
from openfront_ai.train import TrainConfig, Trainer, advantages
from openfront_ai.evaluate import evaluate

torch.set_num_threads(1)


def test_gae_terminal_does_not_bootstrap_reset_episode():
    rewards = torch.tensor([[1.], [2.]])
    dones = torch.tensor([[True], [False]])
    adv, returns = advantages(rewards, dones, torch.tensor([[.5], [.7]]), torch.tensor([3.]), .9, .95)
    assert returns[0].item() == 1.
    assert abs(returns[1].item() - 4.7) < 1e-6


def test_policy_masks_and_optimizer_updates_parameters():
    trainer = Trainer(SimConfig(envs=4, size=6, max_steps=20), TrainConfig(horizon=8, epochs=2, minibatch=16))
    before = {k: v.clone() for k, v in trainer.model.actor.state_dict().items()}
    x, mask, _ = trainer.sim.observe()
    with torch.no_grad():
        dist = trainer.model.actor.distribution(torch.tensor(x), torch.tensor(mask))
        assert (dist.probs[~torch.tensor(mask)] == 0).all()
    metrics = trainer.train_update()
    assert all(np.isfinite(v) for k, v in metrics.items() if v is not None)
    assert any(not torch.equal(v, before[k]) for k, v in trainer.model.actor.state_dict().items())


def test_checkpoint_resume_reproduces_next_update(tmp_path):
    config = TrainConfig(horizon=8, epochs=2, minibatch=16, snapshot_every=1)
    trainer = Trainer(SimConfig(envs=4, size=6, max_steps=20), config)
    trainer.train_update()
    checkpoint = tmp_path / "resume.pt"
    trainer.save(checkpoint)
    trainer.train_update()
    expected = {k: v.clone() for k, v in trainer.model.state_dict().items()}
    expected_map = trainer.sim.owner.copy()
    resumed = Trainer.load(checkpoint)
    resumed.train_update()
    assert resumed.update == trainer.update == 2 and len(resumed.league) == 3
    for k, value in resumed.model.state_dict().items():
        torch.testing.assert_close(value, expected[k], rtol=0, atol=0)
    np.testing.assert_array_equal(resumed.sim.owner, expected_map)


def test_evaluation_completes_requested_episodes():
    r = evaluate(BranchActor(), games=5, max_steps=20, size=6)
    assert r["completed_games"] == 5
    assert 0 <= r["outright_wins"] <= 5
    assert r["mean_episode_steps"] <= 20
    assert len(r["win_rate_95pct_wilson"]) == 2


def test_warmup_produces_teacher_frames_and_resets_worlds():
    trainer = Trainer(SimConfig(envs=4, size=6, max_steps=20), TrainConfig(horizon=4))
    report = trainer.warmup(steps=12, epochs=2)
    assert report["teacher_frames"] > 0
    assert 0 <= report["teacher_agreement"] <= 1
    assert not trainer.sim.ticks.any()
    assert len(trainer.league) == 2
