#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine_dir="$project_dir/vendor/openfrontio"
engine_commit=cd8f7c36a9c5dd658615828261106f24d8cfa60a
mkdir -p "$project_dir/vendor"
if [ ! -d "$engine_dir/.git" ]; then
  if [ -e "$engine_dir" ]; then
    echo "Dependency path already exists without Git metadata: $engine_dir; preserve and review it first." >&2
    exit 1
  fi
  git init "$engine_dir"
  git -C "$engine_dir" remote add origin https://github.com/openfrontio/openfrontio.git
  git -C "$engine_dir" fetch --depth 1 origin "$engine_commit"
  git -C "$engine_dir" checkout --detach FETCH_HEAD
fi
if [ "$(git -C "$engine_dir" rev-parse HEAD)" != "$engine_commit" ]; then
  # Never reset an existing dependency checkout or discard local edits.
  echo "Engine checkout differs from pinned commit $engine_commit; review it before proceeding." >&2
  exit 1
fi
cd "$engine_dir"
# Upstream pins Node 24 and npm 12; npm exec leaves system tools untouched.
npm exec --yes --cache "$project_dir/.cache/npm" --package=npm@12.1.0 -- npm ci --ignore-scripts --cache "$project_dir/.cache/npm"
