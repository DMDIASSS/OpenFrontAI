import argparse
from dataclasses import asdict
import json
import platform
from pathlib import Path
import time

import numpy as np
import torch

from .evaluate import evaluate
from .export import build_userscript
from .sim import SimConfig, TerritorySim
from .train import TrainConfig, Trainer, train
from .model import load_actor
from .select import select_policy


def main():
    parser = argparse.ArgumentParser(description="Local OpenFrontAI surrogate self-play")
    parser.add_argument("--threads", type=int, default=1, help="Torch CPU threads (small networks favor 1)")
    subs = parser.add_subparsers(dest="command", required=True)
    subs.add_parser("doctor")
    bench = subs.add_parser("benchmark")
    bench.add_argument("--envs", type=int, default=64)
    bench.add_argument("--steps", type=int, default=200)
    tr = subs.add_parser("train")
    tr.add_argument("--out", default="runs/first")
    tr.add_argument("--updates", type=int, default=100)
    tr.add_argument("--envs", type=int, default=32)
    tr.add_argument("--size", type=int, default=10)
    tr.add_argument("--max-steps", type=int, default=160)
    tr.add_argument("--seed", type=int, default=1)
    tr.add_argument("--horizon", type=int, default=64)
    tr.add_argument("--epochs", type=int, default=4)
    tr.add_argument("--snapshot-every", type=int, default=5)
    tr.add_argument("--resume", type=Path)
    tr.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    tr.add_argument("--backend", default="surrogate", choices=["surrogate", "engine"])
    tr.add_argument("--warmup-steps", type=int, default=0, help="Optional rule-teacher bootstrap before PPO (new runs only)")
    ev = subs.add_parser("evaluate")
    ev.add_argument("--checkpoint", type=Path)
    ev.add_argument("--games", type=int, default=64)
    ev.add_argument("--seed", type=int, default=10001)
    ev.add_argument("--size", type=int, default=10)
    ev.add_argument("--max-steps", type=int, default=160)
    ev.add_argument("--opponent", default="heuristic", choices=["heuristic", "random", "passive"])
    ev.add_argument("--learner", default="neural", choices=["neural", "heuristic", "random", "passive"])
    ev.add_argument("--out", type=Path)
    ev.add_argument("--backend", choices=["surrogate", "engine"], help="Defaults to checkpoint backend")
    ex = subs.add_parser("export")
    ex.add_argument("--checkpoint", type=Path, required=True)
    ex.add_argument("--out", type=Path, default=Path("dist/policy.json"))
    bundle = subs.add_parser("bundle")
    bundle.add_argument("--source", type=Path, default=Path("third_party/solo-aggrobot.user.js"))
    bundle.add_argument("--policy", type=Path, default=Path("dist/policy.json"))
    bundle.add_argument("--out", type=Path, default=Path("dist/openfront-ai.user.js"))
    bundle.add_argument("--control", action="store_true", help="Enable model control instead of shadow ranking")
    select = subs.add_parser("select", help="Select snapshots on validation seeds, then evaluate held-out seeds")
    select.add_argument("candidates", nargs="+", type=Path)
    select.add_argument("--out", type=Path, default=Path("runs/selected"))
    select.add_argument("--games", type=int, default=32)
    select.add_argument("--seed", type=int, default=10001)
    select.add_argument("--test-seed", type=int, default=20001)
    watch = subs.add_parser("watch", help="Record matches to a self-contained offline HTML viewer")
    watch.add_argument("--checkpoint", type=Path, required=True)
    watch.add_argument("--out", type=Path, default=Path("runs/watch.html"))
    watch.add_argument("--games", type=int, default=1)
    watch.add_argument("--seed", type=int, default=50001)
    watch.add_argument("--max-steps", type=int, default=160)
    watch.add_argument("--opponent", choices=["heuristic", "random", "passive"], default="heuristic")
    watch.add_argument("--backend", choices=["surrogate", "engine"])
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    torch.set_num_threads(args.threads)
    if args.command == "doctor":
        print(json.dumps({"python": platform.python_version(), "torch": str(torch.__version__),
                          "numpy": np.__version__, "cuda_available": torch.cuda.is_available(),
                          "torch_cuda_runtime": torch.version.cuda,
                          "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}, indent=2))
    elif args.command == "benchmark":
        if args.steps < 1:
            parser.error("--steps must be positive")
        sim = TerritorySim(SimConfig(envs=args.envs))
        start = time.perf_counter()
        for _ in range(args.steps):
            _, done, _ = sim.step(sim.baseline())
            sim.reset(np.flatnonzero(done))
        elapsed = time.perf_counter() - start
        print(json.dumps({"world_decisions_per_second": args.envs * args.steps / elapsed,
                          "player_decisions_per_second": args.envs * args.steps * sim.p / elapsed,
                          "elapsed_seconds": elapsed, "domain": "surrogate-v1"}, indent=2))
    elif args.command == "train":
        if args.updates < 1:
            parser.error("--updates must be positive (additional updates when resuming)")
        if args.resume:
            if args.warmup_steps:
                parser.error("Warmup is only supported for a new run")
            trainer = Trainer.load(args.resume, args.device)
        else:
            trainer = Trainer(SimConfig(envs=args.envs, size=100 if args.backend == "engine" else args.size, max_steps=args.max_steps, seed=args.seed),
                              TrainConfig(horizon=args.horizon, epochs=args.epochs, snapshot_every=args.snapshot_every), args.device, args.backend)
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "config.json").write_text(json.dumps({"sim": asdict(trainer.sim.config), "training": asdict(trainer.config)}, indent=2) + "\n")
        if args.warmup_steps:
            if args.warmup_steps < 1:
                parser.error("--warmup-steps must be nonnegative")
            trainer.save(out / "untrained.pt")
            report = trainer.warmup(args.warmup_steps)
            print(json.dumps(report), flush=True)
            (out / "warmup.json").write_text(json.dumps(report, indent=2) + "\n")
            trainer.save(out / "bootstrap.pt")
        train(trainer, args.updates, out)
    elif args.command == "evaluate":
        if args.learner == "neural" and not args.checkpoint:
            parser.error("--learner neural requires --checkpoint")
        actor, checkpoint = load_actor(args.checkpoint) if args.checkpoint else (None, None)
        backend = args.backend or (checkpoint.get("backend", "surrogate") if checkpoint else "surrogate")
        report = evaluate(actor, games=args.games, seed=args.seed, size=100 if backend == "engine" else args.size,
                          max_steps=args.max_steps, opponent=args.opponent, learner=args.learner, backend=backend)
        print(json.dumps(report, indent=2, allow_nan=False))
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    elif args.command == "export":
        actor, checkpoint = load_actor(args.checkpoint)
        data = actor.export(args.out, checkpoint.get("backend", "surrogate"))
        print(json.dumps({"path": str(args.out), "schema": data["schema"], "weights": len(data["weights"])}))
    elif args.command == "bundle":
        print(json.dumps(build_userscript(args.source, args.policy, args.out, args.control), indent=2))
    elif args.command == "select":
        report = select_policy(args.candidates, args.out, args.games, args.seed, args.test_seed)
        print(json.dumps({"selected_update": report["selected_update"], "held_out_test": report["held_out_test"]}, indent=2))
    elif args.command == "watch":
        from .watch import record
        print(json.dumps(record(args.checkpoint, args.out, args.games, args.seed,
                                args.max_steps, args.opponent, args.backend), indent=2))


if __name__ == "__main__":
    main()
