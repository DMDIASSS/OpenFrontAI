"""Explicit promotion on a selection set, followed by a separate test set."""
import json
from pathlib import Path
import shutil

from .evaluate import evaluate
from .model import load_actor


def select_policy(candidates, out, games=32, seed=10001, test_seed=20001):
    if seed == test_seed:
        raise ValueError("Selection and final test seeds must differ")
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    backend = None
    for path in candidates:
        actor, checkpoint = load_actor(path)
        domain = checkpoint.get("backend", "surrogate")
        if backend is not None and backend != domain:
            raise ValueError("Select within one backend; evaluate transfer separately")
        backend = domain
        config = checkpoint["sim_config"]
        report = evaluate(actor, games=games, seed=seed, size=config["size"],
                          max_steps=config["max_steps"], backend=backend)
        row = {"checkpoint": str(Path(path).resolve()), "update": checkpoint["update"],
               "win_rate": report["outright_win_rate"], "land_share": report["mean_land_share"],
               "report": report}
        results.append(row)
        print(json.dumps({k: v for k, v in row.items() if k != "report"}), flush=True)
    if not results:
        raise ValueError("Supply at least one candidate checkpoint")
    best = max(results, key=lambda r: (r["win_rate"], r["land_share"]))
    actor, checkpoint = load_actor(best["checkpoint"])
    config = checkpoint["sim_config"]
    test = evaluate(actor, games=games, seed=test_seed, size=config["size"],
                    max_steps=config["max_steps"], backend=backend)
    target = out / "selected.pt"
    if Path(best["checkpoint"]).resolve() != target.resolve():
        shutil.copy2(best["checkpoint"], target)
    actor.export(out / "policy.json", backend)
    report = {"backend": backend, "selection_seed": seed, "test_seed": test_seed,
              "candidates": results, "selected_checkpoint": best["checkpoint"],
              "selected_update": best["update"], "held_out_test": test,
              "caution": "Selection can overfit; this bounded land-only evaluation is not a promise of increasing strength."}
    (out / "selection.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report
