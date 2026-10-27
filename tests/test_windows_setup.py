import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("windows_setup", Path(__file__).resolve().parents[1] / "scripts/setup_windows.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def test_node_engine_pin():
    setup.check_node("v24.19.0\n")
    for version in ["v22.20.0", "v24.14.0", "v25.0.0"]:
        with pytest.raises(RuntimeError):
            setup.check_node(version)


def test_subprocess_keeps_space_containing_paths_as_arguments(monkeypatch):
    calls = []
    monkeypatch.setattr(setup.subprocess, "run", lambda args, **kwargs: calls.append((args, kwargs)))
    setup.run([Path("E:/My Downloads/python.exe"), "-m", "pip", "install", "-e", "."])
    assert calls[0][0][0] == "E:/My Downloads/python.exe"
    assert calls[0][1]["check"] is True
