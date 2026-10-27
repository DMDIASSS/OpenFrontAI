r"""Native Windows setup: py -3.12 scripts\setup_windows.py (no Bash)."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
ENGINE_COMMIT = "cd8f7c36a9c5dd658615828261106f24d8cfa60a"


def run(args, cwd=ROOT, capture=False):
    return subprocess.run([str(a) for a in args], cwd=cwd, check=True,
                          text=True, stdout=subprocess.PIPE if capture else None)


def require_tool(name):
    executable = shutil.which(name)
    if executable is None:
        raise RuntimeError(f"Install {name} and reopen Command Prompt so it is on PATH.")
    return executable


def check_node(version):
    parts = tuple(int(p) for p in version.strip().lstrip("v").split("."))
    if parts[0] != 24 or parts < (24, 15, 0):
        raise RuntimeError("The pinned engine requires Node.js 24.15 or newer in the 24.x series. Install Node.js 24 from nodejs.org.")


def main():
    if sys.platform != "win32":
        raise RuntimeError("This installer is for native Windows. On Linux use bash scripts/setup.sh.")
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Use Python 3.12: py -3.12 scripts\\setup_windows.py")
    # Check prerequisites before downloading dependencies.
    git, node, npm = require_tool("git"), require_tool("node"), require_tool("npm.cmd")
    check_node(run([node, "--version"], capture=True).stdout)
    os.environ["PIP_CACHE_DIR"] = str(ROOT / ".cache/pip")
    python = ROOT / ".venv/Scripts/python.exe"
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(ROOT / ".venv")
    run([python, "-m", "pip", "install", "--index-url", "https://pypi.org/simple",
         "--extra-index-url", "https://download.pytorch.org/whl/cpu", "-r", "requirements-cpu.lock"])
    run([python, "-m", "pip", "install", "--no-deps", "--no-build-isolation", "-e", "."])
    engine = ROOT / "vendor/openfrontio"
    if not (engine / ".git").is_dir():
        if engine.exists():
            raise RuntimeError(f"Preserve and review existing non-Git directory: {engine}")
        engine.parent.mkdir(parents=True, exist_ok=True)
        run([git, "init", engine])
        run([git, "remote", "add", "origin", "https://github.com/openfrontio/openfrontio.git"], engine)
        run([git, "fetch", "--depth", "1", "origin", ENGINE_COMMIT], engine)
        run([git, "checkout", "--detach", "FETCH_HEAD"], engine)
    head = run([git, "rev-parse", "HEAD"], engine, capture=True).stdout.strip()
    if head != ENGINE_COMMIT:
        raise RuntimeError("Existing engine differs from pinned commit; review it before proceeding. No reset performed.")
    cache = ROOT / ".cache/npm"
    run([npm, "exec", "--yes", "--cache", cache, "--package=npm@12.1.0", "--",
         "npm", "ci", "--ignore-scripts", "--cache", cache], engine)
    run([python, "-m", "openfront_ai.cli", "doctor"])
    print("Setup complete. Run: .venv\\Scripts\\python.exe -m pytest -q")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
