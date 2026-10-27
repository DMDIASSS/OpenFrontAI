"""Package a schema-7 actor into the supplied MIT userscript for localhost."""
import hashlib
import json
from pathlib import Path
import re

from .features import ARCHES


def validate_policy(data):
    h = ARCHES.get(data.get("arch"))
    w = data.get("weights")
    if (data.get("schema") != 7 or h is None or data.get("outputs") != ["branchScore"]
            or not isinstance(w, list) or len(w) != 38*h+h+h+1
            or any(type(v) not in (float, int) or not -5 <= v <= 5 for v in w)):
        raise ValueError("Invalid schema-7 policy")


def build_userscript(source, policy, out, control=False):
    source, policy, out = map(Path, (source, policy, out))
    original_bytes = source.read_bytes()
    text = original_bytes.decode("utf-8-sig")
    data = json.loads(policy.read_text())
    validate_policy(data)
    supported = data.get("supported_kinds", ["wait", "expand", "attack", "build_economy"])
    if not supported or any(k not in ("wait", "expand", "attack", "build_economy") for k in supported):
        raise ValueError("Unsupported action-family contract")
    needle = "const SHADOW_V7_BUNDLED_MODEL = null;"
    if text.count(needle) != 1:
        raise ValueError("Unsupported userscript: expected one schema-7 bundle marker")
    text = text.replace(needle, "const SHADOW_V7_BUNDLED_MODEL = " + json.dumps(data, allow_nan=False) + ";")
    old = "actionRankEnabled:false,actionControlEnabled:false,"
    if text.count(old) != 1:
        raise ValueError("Userscript defaults changed; review the integration")
    text = text.replace(old, f"actionRankEnabled:true,actionControlEnabled:{str(control).lower()},")
    text = text.replace("enabled:false, autoStart:true", "enabled:false, autoStart:false")
    rank = "const rankEnabled=!!(opts.actionRankEnabled&&shadowV7Model);"
    if text.count(rank) != 1:
        raise ValueError("Userscript ranking guard changed; review the integration")
    kinds_js = "[" + ",".join("'" + k + "'" for k in supported) + "]"
    text = text.replace(rank, rank[:-1] + f" && actionable.every(b=>{kinds_js}.includes(b.kind));")
    # Limit both metadata and executable code to a local development game.
    text = re.sub(r"^// @match[^\n]*\n", "", text, flags=re.M)
    text = re.sub(r"^// @(?:downloadURL|updateURL)[^\n]*\n", "", text, flags=re.M)
    text = text.replace("// ==/UserScript==", "// @match        http://localhost/*\n// @match        http://127.0.0.1/*\n// ==/UserScript==")
    text = re.sub(r"^// @name[^\n]*", "// @name         OpenFrontAI Local Neural (Solo AggroBot derivative)", text, count=1, flags=re.M)
    marker = "  'use strict';"
    if text.count(marker) != 1:
        raise ValueError("Userscript entrypoint changed")
    # Override persisted neural toggles in memory only; do not overwrite preferences.
    text = text.replace(marker, marker + "\n  if(!['localhost','127.0.0.1'].includes(location.hostname)) return;", 1)
    marker = "  opts.enabled = false;"
    if text.count(marker) != 1:
        raise ValueError("Userscript startup guard changed")
    text = text.replace(marker, f"  opts.actionRankEnabled=true; opts.actionControlEnabled={str(control).lower()}; opts.autoStart=false;\n" + marker)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    manifest = {"source_sha256": hashlib.sha256(original_bytes).hexdigest(),
                "policy_sha256": hashlib.sha256(policy.read_bytes()).hexdigest(),
                "output_sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
                "mode": "control" if control else "shadow", "hosts": ["localhost", "127.0.0.1"],
                "unsupported_action_fallback": "original rules for the whole decision frame",
                "browser_match_validation": "not performed by the exporter"}
    out.with_suffix(".manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest
