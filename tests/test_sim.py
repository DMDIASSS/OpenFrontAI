import numpy as np
import pytest

from openfront_ai.sim import SimConfig, TerritorySim


def test_rollout_observations_masks_and_resource_invariants():
    a = TerritorySim(SimConfig(envs=4, size=6, max_steps=40, seed=123))
    for _ in range(60):
        x, mask, _ = a.observe()
        assert x.shape == (4, 4, 18, 38)
        assert np.isfinite(x).all() and (x >= 0).all() and (x <= 1).all()
        assert mask[:, :, 0].all()
        actions = a.baseline("random")
        assert np.take_along_axis(mask, actions[..., None], axis=-1).all()
        ra, da, _ = a.step(actions)
        a.reset(np.flatnonzero(da))
        assert np.isfinite(ra).all() and (a.troops >= 0).all() and (a.gold >= 0).all()
        assert ((a.owner >= -1) & (a.owner < 4)).all()


def test_same_seed_same_fixed_action_trace():
    sims = [TerritorySim(SimConfig(envs=3, size=6, seed=99)) for _ in range(2)]
    for _ in range(20):
        actions = np.full((3, 4), 3, np.int64)
        out = [s.step(actions) for s in sims]
        np.testing.assert_array_equal(sims[0].owner, sims[1].owner)
        np.testing.assert_array_equal(sims[0].troops, sims[1].troops)
        np.testing.assert_array_equal(out[0][0], out[1][0])


def test_capture_is_connected_and_spends_troops():
    sim = TerritorySim(SimConfig(envs=1, players=2, size=6))
    sim.owner[:] = -1
    sim.owner[0, 0] = 0
    sim.owner[0, -1] = 1
    sim.troops[:] = 1000
    sim.step(np.array([[3, 0]]))
    owned = set(np.flatnonzero(sim.owner[0] == 0))
    assert len(owned) > 1
    visited, queue = {0}, [0]
    while queue:
        for q in sim.neighbors[queue.pop()]:
            if q in owned and q not in visited:
                visited.add(q); queue.append(q)
    assert visited == owned
    # 6 captured tiles cost at least 6 * 62.5; one growth step cannot refund that.
    assert sim.troops[0, 0] < 1000


def test_cannot_attack_self_or_nonadjacent_enemy():
    sim = TerritorySim(SimConfig(envs=1, players=2, size=6))
    original = sim.owner.copy()
    _, mask, _ = sim.observe()
    assert not mask[0, 0, 4:7].any()  # self target
    assert not mask[0, 0, 7:10].any()  # other corner not adjacent
    sim.step(np.array([[9, 6]]))
    np.testing.assert_array_equal(original, sim.owner)


def test_eliminated_players_do_not_revive_and_terminal_is_reported():
    sim = TerritorySim(SimConfig(envs=2))
    sim.owner[sim.owner == 0] = 1
    _, mask, _ = sim.observe()
    assert not mask[:, 0, 1:].any()
    reward, done, info = sim.step(np.full((2, 4), 3, np.int64))
    assert done.all() and (sim.land()[:, 0] == 0).all()
    assert (sim.troops[:, 0] == 0).all() and (sim.gold[:, 0] == 0).all()
    assert (reward < 0).all() and (info["win_credit"] == 0).all()


def test_illegal_build_waits_and_action_range_rejected():
    sim = TerritorySim(SimConfig(envs=1))
    sim.gold[:] = 0
    sim.step(np.full((1, 4), sim.actions - 1, np.int64))
    assert not sim.factories.any()
    with pytest.raises(ValueError):
        sim.step(np.full((1, 4), sim.actions, np.int64))
