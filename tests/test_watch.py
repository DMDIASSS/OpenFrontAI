import json
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest

from openfront_ai import engine
from openfront_ai.watch import encode_runs, record


def test_run_encoding_round_trip():
    source = [-1, -1, 0, 0, 0, 3, -1]
    runs = encode_runs(source)
    assert [v for v, count in zip(runs[::2], runs[1::2]) for _ in range(count)] == source


def test_project_local_node_is_detected(monkeypatch, tmp_path):
    node = tmp_path / ".tools/node/node-v24.22.1-win-x64/node.exe"
    node.parent.mkdir(parents=True)
    node.touch()
    monkeypatch.setattr(engine, "PROJECT", tmp_path)
    monkeypatch.setattr(engine.shutil, "which", lambda _: None)
    monkeypatch.setattr(engine.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout="v24.22.1\n"))
    assert engine.find_node() == str(node)


@pytest.mark.engine
@pytest.mark.skipif(not (engine.PROJECT / "vendor/openfrontio/node_modules/tsx/dist/cli.mjs").exists(), reason="Engine not installed")
def test_real_replay_records_actual_ownership_and_valid_browser_script(tmp_path):
    out = tmp_path / "replay.html"
    report = record(engine.PROJECT / "models/selected.pt", out, games=2, seed=72, max_steps=4)
    assert report["matches"] == 2 and report["backend"] == "engine" and report["frames"] == 10
    text = out.read_text(encoding="utf-8")
    script = re.search(r"<script>(.*?)</script>", text, re.S).group(1)
    data = json.loads(script.split("const replay=", 1)[1].split(";\nconst $=", 1)[0])
    for match in data["matches"]:
        for f in match["frames"]:
            owners = np.repeat(f["runs"][::2], f["runs"][1::2])
            assert len(owners) == 10000
            for player in f["players"]:
                assert int((owners == player["id"]).sum()) == player["land"]
    javascript = tmp_path / "viewer.js"
    javascript.write_text(script, encoding="utf-8")
    subprocess.run([engine.find_node(), "--check", str(javascript)], check=True, capture_output=True)
    subprocess.run([engine.find_node(), str(engine.PROJECT / "tests/viewer_dom.cjs"), str(out)],
                   check=True, capture_output=True, text=True)
