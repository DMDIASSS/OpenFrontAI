# Validation of the first implementation

Performed in the current cloud instance on 2026-10-27. This is not a claim that
the environment was published or restored in a new task, or that the browser
extension has been exercised in a complete rendered match.

## Verified capabilities

- `bash scripts/setup.sh` completed, including reinstalling pinned Python
  dependencies and repeating the upstream frozen-lock installation with npm 12.1.
- Python 3.12.14, Torch 2.14.1+cpu, NumPy 2.5.4, Node 24.19.0; no GPU exposed.
- **18 tests passed**, with no skips. Tests cover actual engine ownership growth,
  resource/mask invariants, connected surrogate captures, PPO weight updates,
  terminal bootstrapping, exact CPU surrogate checkpoint continuation, fresh-episode
  engine checkpoint continuation, teacher bootstrap, CLI execution, Python/JS
  encoder and inference parity, browser model dispatch and unsupported-action
  fallback, script syntax, and runtime rejection of nonlocal hosts.
- The supplied userscript is byte-for-byte unchanged in `third_party/`.
- `vendor/openfrontio/` remains clean at commit
  `cd8f7c36a9c5dd658615828261106f24d8cfa60a`.
- No public games were contacted and no payment/analytics/CAPTCHA scripts were used.

## Training and throughput

The final simulator experiment ran 300 PPO updates / 614,400 learner transitions.
The randomized-spawn engine experiment ran 300 updates / 153,600 learner
transitions from scratch. A separate engine run used 2,921 actionable rule-teacher
frames (82.1% training-set teacher agreement), followed by 150 PPO updates /
76,800 learner transitions. Imitation agreement is not held-out performance.

Observed CPU throughput was roughly 2,700–2,900 learner decisions/second for the
surrogate PPO loop and 450–600 for the real-engine loop, depending on concurrent
workload. The standalone surrogate benchmark (`--envs 64 --steps 200`) measured
6,603 world decisions/second, or 26,413 player decisions/second. These are local
measurements, not universal performance promises or measured speedups over a
rendered full game. Engine decisions advance up to 20 real ticks each.

## Strength results and promotion

Initial tests exposed a simulator-to-engine gap: a surrogate-trained policy grew
territory but lost all four initial fixed-spawn engine smoke matches. The real
headless backend was added rather than interpreting simulator wins as game skill.

The selected release policy is the **teacher bootstrap**, not the latest PPO
checkpoint. On selection seed 10001, it scored 11/64 territory-score wins (17.2%).
The bootstrapped model's later PPO snapshots through update 150 tied this greedy
result. Random-initialized direct-engine PPO snapshots did worse. The selector
therefore retained the earlier policy. The PPO updates executed and changed
weights, but this run does **not** demonstrate an additional greedy-strength gain
from self-play beyond the teacher bootstrap.

The final selected policy was evaluated with greedy actions on **seed 30001**,
separate from the selection seed, against three local heuristic policies using
the actual engine on its 100×100 plains map:

| Outcome | Result |
| --- | --- |
| Completed RL episodes | 64 |
| Outright territory-score wins | 14 / 64 (21.875%) |
| Full conquests by the learner | 7 |
| Games reaching the 160-decision budget | 13 |
| Learner eliminations | 44 |
| Mean final land share | 18.119% |
| Wilson 95% interval for score-win probability | 13.50%–33.43% |

Each budget-limited episode is scored by land plus a small troop tie-breaker;
it is not a full conquest. These outcomes are restricted to the land-only adapter,
spawn distribution and this project's heuristic opponents. They establish neither
human-level ability nor performance against built-in Impossible nations or other
maps. Training and evaluation still share the plains map family.

Machine-readable reports are included in the release ZIP under `reports/`,
including the final selection report, final evaluation, configuration, warmup
metrics, and self-play training metrics. Earlier experiments remain under `runs/`
in this workspace.

## Delivered artifacts and remaining limits

`dist/policy.json` contains the selected 1,601-parameter schema-7 policy.
`dist/openfront-ai-shadow.user.js` and `dist/openfront-ai-control.user.js` embed it
into local-only derivatives of the supplied extension, with provenance manifests.
Both start disabled. Unsupported action families fall back to the original rules.

`dist/openfront-ai-starter.zip` includes source, tests, setup scripts, these
generated files, the selected bootstrap checkpoint, and the later self-play
checkpoint for continued experimentation. It excludes dependencies, caches,
upstream source/assets, website captures and unrelated uploads.

Still unvalidated: complete browser discovery/emission in the current client,
rendered UI integration, GPU execution, Windows-native engine setup, new-task
snapshot restoration, and broad-map/full-mechanics strength. The land-only engine
adapter does not construct buildings, trade, ally, launch boats or use nukes.

The new project files are local and uncommitted; no push or publication occurred.
Reusable `install_script` and `start_skill` were saved to the environment draft.
Review and save them in environment settings, then publish the environment if
you want this prepared filesystem snapshot available to future cloud tasks.

## Offline replay viewer update

The `watch` command now records checkpoint-controlled matches to a standalone HTML
file. Engine ownership pixels are checked against actual per-player tile counts.
The real viewer JavaScript is tested in jsdom for canvas pixel output, statistics,
playback, stepping, scrubbing, match switching and restart (canvas output captured
as RGBA data). All 23 tests pass after this update. The cloud Chromium file-URL
policy blocked its screenshot test; a full Windows browser run remains unverified.
An actual two-match recording is included as `dist/example-match.html`.
Node installed in the project-local Windows bootstrap directory is now detected
automatically by the engine subprocess adapter.
