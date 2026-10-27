#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
export PIP_CACHE_DIR="$project_dir/.cache/pip"
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-cpu.lock
.venv/bin/python -m pip install --no-deps --no-build-isolation -e .
bash scripts/setup_engine.sh
.venv/bin/python -m openfront_ai.cli doctor
