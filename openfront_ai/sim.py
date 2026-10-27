"""Batched macro-tile *surrogate*, not a reimplementation of OpenFront.

Each decision is roughly a few seconds of compressed gameplay. Land is a
connected grid, troops are pooled per player, and attacks resolve immediately.
There are no graphics, sockets, pathfinding workers, or wall-clock waits.
All simplifications and excluded mechanics are documented in README.md.
"""
from dataclasses import asdict, dataclass
import numpy as np

from .features import INPUTS


@dataclass(frozen=True)
class SimConfig:
    envs: int = 32
    players: int = 4
    size: int = 10
    max_steps: int = 160
    seed: int = 1

    def __post_init__(self):
        if self.envs < 1 or not 2 <= self.players <= 4 or self.size < 4 or self.max_steps < 2:
            raise ValueError("Need envs>=1, 2<=players<=4, size>=4, max_steps>=2")


class TerritorySim:
    fractions = np.array([.2, .5, .8], dtype=np.float32)

    def __init__(self, config=SimConfig()):
        self.config = config
        self.rng = np.random.default_rng(config.seed)
        self.n, self.p, self.s = config.envs, config.players, config.size
        self.tiles = self.s ** 2
        self.actions = 1 + 3 + self.p * 3 + 2
        self.e = np.arange(self.n)
        ids = np.arange(self.tiles).reshape(self.s, self.s)
        # Boundary neighbor points back at the same tile; never wraps rows.
        self.neighbors = np.stack([
            np.vstack((ids[:1], ids[:-1])), np.vstack((ids[1:], ids[-1:])),
            np.hstack((ids[:, :1], ids[:, :-1])), np.hstack((ids[:, 1:], ids[:, -1:])),
        ], -1).reshape(self.tiles, 4)
        self.owner = np.full((self.n, self.tiles), -1, dtype=np.int16)
        self.terrain = np.zeros((self.n, self.tiles), dtype=np.float32)
        self.troops = np.zeros((self.n, self.p), dtype=np.float32)
        self.gold = np.zeros_like(self.troops)
        self.cities = np.zeros_like(self.troops)
        self.factories = np.zeros_like(self.troops)
        self.prev_troops = np.zeros_like(self.troops)
        self.ticks = np.zeros(self.n, dtype=np.int32)
        self.reset()

    def reset(self, indices=None):
        ix = self.e if indices is None else np.asarray(indices)
        if not len(ix):
            return
        self.owner[ix] = -1
        corners = np.array([0, self.tiles - 1, self.s - 1, self.tiles - self.s])
        for i in ix:
            self.owner[i, self.rng.permutation(corners)[:self.p]] = np.arange(self.p)
        self.terrain[ix] = self.rng.uniform(.7, 1.5, (len(ix), self.tiles))
        self.troops[ix] = self.rng.uniform(750, 1100, (len(ix), self.p))
        self.prev_troops[ix] = self.troops[ix]
        self.gold[ix] = 600
        self.cities[ix] = 0
        self.factories[ix] = 0
        self.ticks[ix] = 0

    def land(self):
        return (self.owner[:, None, :] == np.arange(self.p)[None, :, None]).sum(-1)

    def borders(self, player):
        near = (self.owner[:, self.neighbors] == player).any(-1)
        return near & (self.owner != player)

    def capacity(self, land=None):
        land = self.land() if land is None else land
        return 1200 + 350 * land + 700 * self.cities

    def observe(self):
        """Return [env, player, candidate, feature], legality, rule utilities.

        The actor never receives hidden future state, map seed, or player id.
        Only legal land/wait/economy branches are trained. Other schema-7
        families are deliberately masked from exported browser deployment.
        """
        land = self.land()
        x = np.zeros((self.n, self.p, self.actions, INPUTS), np.float32)
        mask = np.zeros(x.shape[:-1], bool)
        utility = np.full(x.shape[:-1], -1000., np.float32)
        for p in range(self.p):
            home = np.maximum(1., self.troops[:, p])
            alive = land[:, p] > 0
            border = self.borders(p)
            neutral = (border & (self.owner == -1)).sum(-1)
            fronts = np.stack([(border & (self.owner == q)).sum(-1)
                               for q in range(self.p)], -1)
            enemy = fronts > 0
            strength = np.max(np.where(enemy, self.troops, 0), -1) / home
            a = x[:, p]
            a[:, :, 0] = np.minimum(1., self.ticks / self.config.max_steps)[:, None]
            a[:, :, 1] = alive[:, None]  # maxLand falls back to current land in the extension
            a[:, :, 2] = 1.
            a[:, :, 3] = .25
            a[:, :, 4] = (np.log1p(self.gold[:, p]) / np.log1p(1e7) / 2)[:, None]
            a[:, :, 5] = np.minimum(1., (.5 * land[:, p] + 18 * self.factories[:, p]) / 2000)[:, None]
            a[:, :, 6] = np.minimum(1., strength)[:, None]
            a[:, :, 7] = (enemy.sum(-1) / 8)[:, None]
            a[:, :, 8] = ((enemy.sum(-1) + (neutral > 0)) / 8)[:, None]
            a[:, :, 12] = .5  # unavailable in current extension
            a[:, :, 13] = (np.clip((home - self.prev_troops[:, p]) /
                                  np.maximum(1., self.prev_troops[:, p]), -1, 1) / 2 + .5)[:, None]
            a[:, :, 18] = 1.
            a[:, :, 23] = 1.
            mask[:, p, 0] = True
            utility[:, p, 0] = 10 + 35 * np.clip(strength - .5, 0, 1)
            a[:, 0, 22] = np.clip(1 - strength / 2, 0, 1)
            a[:, 0, 29] = 1  # wait
            for k, fraction in enumerate(self.fractions):
                j = 1 + k
                cost = home * fraction
                possible = np.minimum(6, np.minimum(neutral, cost / 70))
                mask[:, p, j] = alive & (possible >= 1)
                utility[:, p, j] = 65 + 6 * possible - 35 * fraction
                a[:, j, 16:18] = fraction
                a[:, j, 18] = 1 - fraction
                a[:, j, 20] = possible / home
                a[:, j, 25] = a[:, j, 28] = a[:, j, 30] = 1
            for q in range(self.p):
                for k, fraction in enumerate(self.fractions):
                    j = 4 + q * 3 + k
                    defense = self.troops[:, q] / np.maximum(1, land[:, q])
                    possible = np.minimum(6, np.minimum(land[:, q], home * fraction / (defense * 1.2 + 70)))
                    mask[:, p, j] = alive & (q != p) & (fronts[:, q] > 0) & (home * fraction >= 70)
                    utility[:, p, j] = 30 + 12 * possible - 30 * fraction - 30 * np.minimum(2, defense / home)
                    a[:, j, 16:18] = fraction
                    a[:, j, 18] = 1 - fraction
                    a[:, j, 19] = np.clip(self.troops[:, q] / home, 0, 1)
                    a[:, j, 20] = possible / home
                    a[:, j, 25] = a[:, j, 31] = 1
            for k in range(2):
                j = self.actions - 2 + k
                count = self.cities[:, p] if k == 0 else self.factories[:, p]
                price = 800 * 1.6 ** count
                mask[:, p, j] = alive & (self.gold[:, p] >= price) & (land[:, p] >= 3) & (count < 6)
                utility[:, p, j] = 50 - 4 * count
                a[:, j, 21] = (1 / (1 + count)) * (.65 if k == 0 else 1.)
                a[:, j, 36] = 1  # build_economy; cost is 0 in candidateToBranch
            top = np.where(mask[:, p], utility[:, p], -1000).max(-1)
            a[:, :, 14] = np.clip((utility[:, p] + 100) / 200, 0, 1)
            a[:, :, 15] = np.clip((top[:, None] - utility[:, p]) / 100, 0, 1)
        return x, mask, utility

    def baseline(self, mode="heuristic", observation=None):
        _, mask, utility = self.observe() if observation is None else observation
        if mode == "heuristic":
            scores = utility
        elif mode == "random":
            scores = self.rng.random(mask.shape)
        elif mode == "passive":
            return np.zeros((self.n, self.p), np.int64)
        else:
            raise ValueError(mode)
        return np.where(mask, scores, -np.inf).argmax(-1)

    def step(self, actions):
        actions = np.asarray(actions)
        if actions.shape != (self.n, self.p) or not np.issubdtype(actions.dtype, np.integer):
            raise ValueError(f"Expected integer actions of shape {(self.n, self.p)}")
        if np.any((actions < 0) | (actions >= self.actions)):
            raise ValueError("Action outside candidate space")
        # Legality is rechecked after earlier players act. Stale/illegal choices wait.
        before = self.land()
        self.prev_troops[:] = self.troops
        for p in self.rng.permutation(self.p):
            alive = (self.owner == p).any(-1)
            a = actions[:, p]
            expansion = (a >= 1) & (a <= 3) & alive
            attack = (a >= 4) & (a < 4 + self.p * 3) & alive
            target = np.where(expansion, -1, (a - 4) // 3)
            attack &= target != p
            fraction = self.fractions[np.clip(np.where(expansion, a - 1, (a - 4) % 3), 0, 2)]
            budget = np.where(expansion | attack, self.troops[:, p] * fraction, 0.)
            # Spend only actual attrition; unspent committed troops return home.
            for _ in range(6):
                available = self.borders(p) & (self.owner == target[:, None]) & (expansion | attack)[:, None]
                # Randomized frontier tile, independent of the policy observations.
                tile = np.where(available, self.rng.random(available.shape), -1).argmax(-1)
                valid = available[self.e, tile]
                q = np.clip(target, 0, self.p - 1)
                lands = self.land()
                defense = np.where(attack, self.troops[self.e, q] / np.maximum(1, lands[self.e, q]), 0.)
                cost = (45 + 25 * self.terrain[self.e, tile]) + 1.2 * defense
                take = valid & (budget >= cost)
                budget -= np.where(take, cost, 0)
                self.troops[:, p] -= np.where(take, cost, 0)
                loss = np.where(take & attack, defense, 0)
                self.troops[self.e, q] -= loss
                self.owner[self.e[take], tile[take]] = p
            lands = self.land()
            for k, counts in enumerate((self.cities, self.factories)):
                price = 800 * 1.6 ** counts[:, p]
                build = (a == self.actions - 2 + k) & (lands[:, p] >= 3) & (self.gold[:, p] >= price) & (counts[:, p] < 6)
                self.gold[:, p] -= np.where(build, price, 0)
                counts[:, p] += build
        land = self.land()
        alive = land > 0
        cap = self.capacity(land)
        self.troops += (40 + 14 * land + 40 * self.cities) * np.clip(1 - self.troops / cap, 0, 1)
        self.troops = np.where(alive, np.clip(self.troops, 0, cap), 0).astype(np.float32)
        self.gold = np.where(alive, np.minimum(1e7, self.gold + .5 * land + 18 * self.factories), 0).astype(np.float32)
        self.ticks += 1
        # Entire world ends on p0 elimination, conquest, or fixed decision budget.
        done = (~alive[:, 0]) | (alive.sum(-1) <= 1) | (self.ticks >= self.config.max_steps)
        # Bounded potential shaping + terminal rank, no reward for clicking.
        potential_before = before[:, 0] / self.tiles
        potential_after = land[:, 0] / self.tiles
        reward = .3 * (.99 * np.where(done, 0, potential_after) - potential_before)
        score = land + .05 * self.troops / np.maximum(1, cap)
        others = score[:, 1:]
        rank_reward = ((score[:, :1] > others).sum(-1) - (score[:, :1] < others).sum(-1)) / (self.p - 1)
        reward += np.where(done, rank_reward, 0)
        winner = score.argmax(-1)
        # Treat exact ties as shared wins in evaluation.
        ties = np.isclose(score, score.max(-1, keepdims=True), rtol=0, atol=1e-6)
        info = {"land": land.copy(), "winner": winner, "score": score,
                "win_credit": ties[:, 0] / ties.sum(-1), "steps": self.ticks.copy(),
                "config": asdict(self.config)}
        return reward.astype(np.float32), done, info
