import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
import pytest
import torch

from openfront_ai.export import build_userscript, validate_policy
from openfront_ai.features import features
from openfront_ai.model import BranchActor
from openfront_ai.sim import SimConfig, TerritorySim

ROOT = Path(__file__).resolve().parents[1]


def node(code, payload):
    if not shutil.which("node"):
        pytest.skip("Node is needed for browser compatibility tests")
    result = subprocess.run(["node", "-e", code], input=json.dumps(payload),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_python_js_feature_and_prediction_parity(tmp_path):
    torch.manual_seed(9)
    actor = BranchActor()
    model = actor.export(tmp_path / "policy.json")
    cases = []
    rng = np.random.default_rng(123)
    for kind in ["wait", "expand", "attack", "build_economy", "boat"]:
        for _ in range(10):
            state = dict(home=float(rng.uniform(100, 10000)), troops=800, reserve=300,
                         gold=float(rng.uniform(0, 1e7)), gamePhase=11, land=23, maxLand=100,
                         income=.7, enemyPressure=.3, activeWars=2, frontCount=3,
                         allyPressure=.4, homeThreat=.2, nukeThreat=.8,
                         recentLandTrend=-.3, recentTroopTrend=.6)
            branch = dict(kind=kind, ruleUtility=float(rng.uniform(-1000, 200)),
                          cost=500, troopCommitment=500, reserveAfter=100,
                          targetStrength=.3, targetLand=.7, expectedBuildValue=.8,
                          expectedDefenseValue=.2, cooldownReady=True, alreadyActiveOperation=False,
                          targetReachable=True, isEmergency=False, isFinisher=True, isExpansion=False)
            cases.append(dict(state=state, branch=branch, top=100))
    predicted = node("const fs=require('fs');const v=require(" + json.dumps(str(ROOT / "browser/schema7.cjs")) + ");"
                     "const d=JSON.parse(fs.readFileSync(0,'utf8'));"
                     "console.log(JSON.stringify(d.cases.map(c=>{const x=v.features(c.state,c.branch,{ruleTop1:c.top});"
                     "return {x,y:v.predict(d.model,x).branchScore}})));", {"cases": cases, "model": model})
    x = np.stack([features(c["state"], c["branch"], c["top"]) for c in cases])
    np.testing.assert_allclose(x, [p["x"] for p in predicted], atol=1e-7)
    with torch.no_grad():
        expected = actor(torch.tensor(x)).numpy()
    np.testing.assert_allclose(expected, [p["y"] for p in predicted], atol=1e-6)
    # Actual vectorized simulator observations are accepted by the original JS validator.
    sim = TerritorySim(SimConfig(envs=2))
    vectors = sim.observe()[0].reshape(-1, 38).tolist()
    result = node("const fs=require('fs');const v=require(" + json.dumps(str(ROOT / "browser/schema7.cjs")) + ");"
                  "const d=JSON.parse(fs.readFileSync(0,'utf8'));"
                  "console.log(JSON.stringify(d.x.map(x=>v.predict(d.model,x).branchScore)));", {"model": model, "x": vectors})
    assert len(result) == len(vectors) and np.isfinite(result).all()


def test_export_rejects_bad_weights():
    for value in [float("nan"), float("inf"), 6, "0", None]:
        model = {"schema": 7, "arch": "38x24x2-tanh", "outputs": ["branchScore"], "weights": [0.] * 961}
        model["weights"][0] = value
        with pytest.raises(ValueError):
            validate_policy(model)


def test_bundle_is_local_only_and_disabled_at_start(tmp_path):
    source = ROOT / "third_party/solo-aggrobot.user.js"
    policy = tmp_path / "policy.json"
    BranchActor().export(policy)
    out = tmp_path / "bot.user.js"
    manifest = build_userscript(source, policy, out, control=True)
    text = out.read_text()
    assert "// @match        https://openfront.io" not in text
    assert "@downloadURL" not in text and "@updateURL" not in text
    assert "opts.actionControlEnabled=true" in text
    assert "opts.autoStart=false" in text
    assert "opts.enabled = false" in text
    assert "actionable.every(b=>['wait','expand','attack','build_economy'].includes(b.kind))" in text
    assert manifest["mode"] == "control"
    subprocess.run(["node", "--check", str(out)], check=True, capture_output=True)
    # The runtime hostname guard must return before touching a public game's window.
    node("const fs=require('fs'),vm=require('vm');const d=JSON.parse(fs.readFileSync(0,'utf8'));"
         "vm.runInNewContext(d.code,{location:{hostname:'openfront.io'}});console.log('true');", {"code": text})


def test_real_ranker_uses_model_and_falls_back_for_untrained_families(tmp_path):
    policy = tmp_path / "policy.json"
    model = BranchActor().export(policy, domain="engine")
    out = tmp_path / "bot.user.js"
    build_userscript(ROOT / "third_party/solo-aggrobot.user.js", policy, out, control=True)
    text = out.read_text()
    start = text.index("  function chooseActionBranch(")
    end = text.index("  // Steer emission", start)
    result = node("const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8'));"
                  "const shadowV7=require(" + json.dumps(str(ROOT / "browser/schema7.cjs")) + ");"
                  "const opts={actionRankEnabled:true,actionControlEnabled:true};"
                  "const shadowV7Model=d.model,branchFunnel={rankErrors:0};"
                  "const branchState=()=>({home:1000,land:10});"
                  "const candidateToBranch=c=>({...c,ruleUtility:c.utility,legal:true,safetyApproved:true,executableNow:true});"
                  "eval(d.fn+';globalThis.choose=chooseActionBranch');"
                  "const run=kind=>choose({candidates:[{id:'a',kind,utility:30},{id:'b',kind:'wait',utility:20}]},{home:1000},{},[],1);"
                  "const a=run('attack'),b=run('boat'),c=run('build_economy');"
                  "console.log(JSON.stringify({a:a.basis,control:a.controlActive,scored:Object.keys(a.scores).length,b:b.basis,c:c.basis}));",
                  {"fn": text[start:end], "model": model})
    assert result == {"a": "model", "control": True, "scored": 2, "b": "no-model", "c": "no-model"}
