"""Exact schema-7 feature contract from Solo AggroBot 1.21.6 (MIT).

Keep these normalizations aligned with candidateToBranch / branchState in the
uploaded userscript, not with what a simulator might ideally observe.
"""
import numpy as np

KINDS = ("wait", "expand", "attack", "boat", "warship", "build_warship",
         "nuclear", "build_economy", "donate")
INPUTS = 38
ARCHES = {"38x24x2-tanh": 24, "38x40x2-tanh": 40}


def features(state: dict, branch: dict, top_utility: float) -> np.ndarray:
    """Reference scalar encoder, also used by cross-language compatibility tests."""
    def c(v, lo=0., hi=1.):
        return float(np.clip(v if np.isfinite(v) else lo, lo, hi))
    home = max(1., state.get("home", 1.) or 1.)
    land = state.get("land", 0.)
    ru = branch.get("ruleUtility", 0.)
    x = [
        c(state.get("gamePhase", 0.) / 20),
        c(land / max(1., state.get("maxLand", land))) if land else 0.,
        c((state.get("troops", 0.) or home) / home),
        c(state.get("reserve", 0.) / home),
        c(np.log1p(max(0., state.get("gold", 0.))) / np.log1p(1e7), 0, 2) / 2,
        c(state.get("income", 0.), 0, 2) / 2,
        c(state.get("enemyPressure", 0.)), c(state.get("activeWars", 0.) / 8),
        c(state.get("frontCount", 0.) / 8), c(state.get("allyPressure", 0.)),
        c(state.get("homeThreat", 0.)), c(state.get("nukeThreat", 0.)),
        c(state.get("recentLandTrend", 0.), -1, 1) / 2 + .5,
        c(state.get("recentTroopTrend", 0.), -1, 1) / 2 + .5,
        c((ru + 100) / 200), c((top_utility - ru) / 100),
        c(branch.get("cost", 0.) / home),
        c(branch.get("troopCommitment", 0.) / home),
        c(branch.get("reserveAfter", 0.) / home),
        c(branch.get("targetStrength", 0.)), c(branch.get("targetLand", 0.)),
        c(branch.get("expectedBuildValue", 0.)), c(branch.get("expectedDefenseValue", 0.)),
        *[float(bool(branch.get(k, False))) for k in
          ("cooldownReady", "alreadyActiveOperation", "targetReachable", "isEmergency",
           "isFinisher", "isExpansion")],
        *[float(branch.get("kind") == k) for k in KINDS],
    ]
    return np.clip(x, 0, 1).astype(np.float32)
