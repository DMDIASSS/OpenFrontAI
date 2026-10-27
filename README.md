# OpenFrontAI — local neural self-play starter

A working first training pipeline, **not a finished all-mechanics OpenFront AI**.
It learns a tiny neural ranker for legal action candidates and exports it into
the supplied Solo AggroBot userscript. No screenshots, image recognition,
payment SDKs, public-game connections, or CUDA toolkit are needed for training.

The prepared ZIP includes `models/selected.pt` (the retained bootstrap policy),
`models/selfplay-latest.pt` (the later engine PPO checkpoint), generated scripts
under `dist/`, and measured results under `reports/`. After installing, you can
continue immediately with:

```bash
.venv/bin/python -m openfront_ai.cli train \
  --resume models/selfplay-latest.pt --updates 100 --out runs/continued
```

In the original cloud workspace those checkpoints are instead at
`runs/final-selected/selected.pt` and `runs/engine-bootstrap/latest.pt`.

Two training backends are provided:

| Backend | What it runs | What it is useful for |
| --- | --- | --- |
| `surrogate` | Batched NumPy macro-tile worlds, instant combat, simplified growth/economy | Fast algorithm experiments; its win rate does **not** measure real-game ability |
| `engine` | The actual pinned OpenFront TypeScript engine, no rendering or sockets | Direct land-only training and evaluation against local heuristic opponents |

Both use clipped PPO, GAE, an actor/critic, legal-action masks, randomized spawns,
entropy regularization, terminal rank rewards, small potential-based land rewards,
and a bounded league of historical policies. Opponent assignments mix 40% historical,
25% current-policy self-play, 25% rules, and 10% random policies. The learner always
occupies seat zero, with its physical spawn position randomized. Historical
opponents are frozen and only the learner's actions contribute PPO gradients.

The actor is a 38 → 40 → 1 tanh network with **1,601 weights and biases**. It scores
each legal branch using the uploaded extension's schema-7 features. This is a
candidate ranker: it does not choose arbitrary clicks, generate code, or control
the extension's complete strategy/economy/diplomacy systems.

## Install

Tested here with Linux, Python 3.12, Node 24.19, npm 12.1 (scoped to the engine),
and CPU PyTorch. From this repository:

```bash
bash scripts/setup.sh
.venv/bin/python -m openfront_ai.cli doctor
.venv/bin/python -m pytest -q
```

`setup.sh` installs the tested CPU dependency lock, installs this project editable,
and fetches OpenFront at `cd8f7c36a9c5dd658615828261106f24d8cfa60a` into ignored
`vendor/openfrontio/`. The upstream package lock is installed with npm 12.1 and
`--ignore-scripts`; the headless engine does not need native canvas builds.
The upstream checkout is left unmodified. Expect roughly 1–2 GB for the engine,
maps and JS dependencies in addition to the Python environment. Setup does not
launch a web server or start an unlimited training job.

For only the lightweight simulator, omit `setup_engine.sh` and install:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -e '.[test]'
```

For native Windows Command Prompt, install Python 3.12, Git for Windows and
Node.js 24.15+ (24.x), then reopen Command Prompt and run:

```bat
py -3.12 scripts\setup_windows.py
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m openfront_ai.cli train --resume models/selfplay-latest.pt --updates 100 --out runs/continued
```

Use `.venv\Scripts\python.exe` in place of `.venv/bin/python` in the commands
below. The native installer has prerequisite/unit checks; Windows execution has
not been tested in this Linux cloud instance. WSL2 remains an alternative.
There is no knowledge
of your PC's existing Torch/CUDA installation in this project. To locate existing
interpreters and inspect NVIDIA availability in PowerShell, use `py -0p`,
`Get-Command python`, and `nvidia-smi`. Install a GPU PyTorch wheel using the
[official selector](https://pytorch.org/get-started/locally/) matched to your
driver, in a separate venv instead of this CPU lock. `doctor` reports what that
interpreter can actually access; `--device cuda` opts into it. These tiny networks
and CPU game engines can be faster on CPU, so a GPU is optional.

## Train, resume, evaluate

Recommended first real-engine experiment (finite run):

```bash
.venv/bin/python -m openfront_ai.cli train \
  --backend engine --envs 16 --horizon 32 --warmup-steps 128 \
  --snapshot-every 25 --updates 150 --out runs/my-engine
```

The optional warmup clones the visible rule baseline before PPO. Its teacher
agreement is an imitation metric, **not** a win rate or evidence of learning from
self-play. `bootstrap.pt` separates the teacher-trained model from later PPO
snapshots. Omit `--warmup-steps` to start PPO from a random network.

For a fast surrogate experiment:

```bash
.venv/bin/python -m openfront_ai.cli benchmark --envs 64 --steps 200
.venv/bin/python -m openfront_ai.cli train --envs 32 --updates 100 --out runs/my-sim
```

Each update saves `latest.pt`, schema-7 `policy.json`, and JSONL training metrics.
Periodic `snapshot-*.pt` files preserve earlier policies. Run directories are
ignored by Git. Stop with Ctrl+C; the latest **completed** update is retained.

```bash
.venv/bin/python -m openfront_ai.cli train \
  --resume runs/my-engine/latest.pt --updates 100 --out runs/my-engine
.venv/bin/python -m openfront_ai.cli evaluate \
  --checkpoint runs/my-engine/latest.pt --games 64 --seed 20001 \
  --out runs/my-engine/evaluation.json
```

`--updates` is the number of **additional** updates on resume. Checkpoints restore
optimizer, model, opponent pool, training counters and RNGs. The surrogate also
restores the exact world state (tested for bit-for-bit CPU continuation). Engine
checkpoints restart fresh episodes; in-flight TypeScript worlds are not serialized.
Inference and export load weights without launching environments. Evaluation
defaults to the checkpoint backend; explicitly pass `--backend engine` when
testing transfer from a surrogate-trained model.

Evaluation uses greedy action selection, matching browser deployment, not the
stochastic sampling used for PPO. Every requested episode must finish, including
the configured decision-budget limit; budget-limited games are scored by territory
plus a small troop tie-breaker. Reports include outright wins, shared-win credit,
land share and a Wilson interval. Opponents called `heuristic` are this project's
rule policy, **not** OpenFront's built-in Impossible nations or human players.

More training can regress. Select among checkpoints on one set of seeds, then
measure the selected policy on separate seeds:

```bash
.venv/bin/python -m openfront_ai.cli select \
  runs/my-engine/bootstrap.pt runs/my-engine/snapshot-*.pt \
  --games 32 --seed 10001 --test-seed 20001 --out runs/my-selected
```

This saves `selected.pt`, `policy.json`, and `selection.json`. Include a previous
champion in the candidate list when considering an update. Selection is an
experimental gate, not a statistical guarantee that each new model is stronger.
Use untouched seeds/maps for later claims, not repeatedly tuned selection sets.

## Export into the existing extension

```bash
.venv/bin/python -m openfront_ai.cli export \
  --checkpoint runs/my-selected/selected.pt --out dist/policy.json
.venv/bin/python -m openfront_ai.cli bundle \
  --policy dist/policy.json --out dist/openfront-ai-shadow.user.js
.venv/bin/python -m openfront_ai.cli bundle \
  --policy dist/policy.json --control --out dist/openfront-ai-control.user.js
```

Install **one** generated userscript in your userscript manager, disable the
original copy, open a local OpenFront development game, and enable the bot from
its panel after entering single-player. Shadow mode scores but retains rule
control; `--control` lets the model rank supported legal candidates. The generated
script starts disabled, disables auto-start, removes upstream update URLs, and
has both metadata and runtime guards for `localhost` / `127.0.0.1` only. It never
automatically joins a public game. Each build has a SHA-256 provenance manifest.

The original planner's downstream legality checks remain authoritative. When a
decision frame contains any action family the model did not train, the whole
frame falls back to the original rules. Engine-trained models support wait,
expand and attack. Surrogate-trained models additionally support basic economy
ranking. This fallback deliberately limits how often a land-only model can steer
the full extension. Other rule controllers and action emitters remain active.

Python/JavaScript feature and inference parity, model validation, local-only
guards, and bundle syntax are tested. **Browser discovery and full UI operation
against the current upstream client have not been validated.** The standalone
headless adapter verifies actual engine interaction independently of that browser
hook. If a future client changes its internal discovery API, the browser bridge
will need an integration update, even when the exported neural format is valid.

To launch the optional local UI, use upstream's documented development commands
from `vendor/openfrontio/` (`npm run dev` with its required npm 12 toolchain).
This is separate from training and is not automatically started by this project.
See upstream README for its development environment and server configuration.

## Boundaries and next work

The real backend uses unmodified engine growth, attrition, ownership and attack
execution on the 100×100 plains fixture. There are four Human-type engine seats
driven by local policies, no built-in nation AI. Spawns vary within four quadrants.
Actions occur every 20 engine ticks, with at most one outgoing attack per player.
There are no economy construction, naval, nuclear or diplomatic actions in this
adapter. Both training and test worlds share the plains map family. A successful
test here is **not** a claim of full-game or human-level strength.

The surrogate supports 2–4 players, three troop commitment fractions, connected
frontier captures, terrain-dependent attrition, pooled troops, logistic growth,
and abstract city/factory investment. Its coefficients are intentionally simplified,
not extracted exact OpenFront rules. Combat is instant, buildings are player-level
counts and survive conquest, and the map has no water. It excludes spatial
structure placement, ongoing operations, spawn immunity, supply lines, boats,
nukes, alliances, trade and fog-of-war. Faster decisions are not a measured
speedup over a full rendered match.

Useful next stages are broader terrain/maps, built-in nation opponents, real
economy/naval actions, a validated browser observation/intent adapter, and longer
out-of-sample evaluation. There is no online-learning or telemetry upload in the
userscript: improvements require running training, evaluating, and exporting a
new model.

See [VALIDATION.md](VALIDATION.md) for the concrete results of this implementation
run, and [third_party/NOTICE.md](third_party/NOTICE.md) for source provenance.
The user-provided HTML capture and Stripe/CAPTCHA/analytics files are unnecessary
for this source-level local workflow and have not been executed or bundled.
