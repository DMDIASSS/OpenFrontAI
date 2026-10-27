import json
import subprocess
import sys


def test_documented_benchmark_command_executes():
    result = subprocess.run([sys.executable, "-m", "openfront_ai.cli", "benchmark", "--envs", "2", "--steps", "2"],
                            capture_output=True, text=True, check=True)
    report = json.loads(result.stdout)
    assert report["world_decisions_per_second"] > 0
    assert report["player_decisions_per_second"] == 4 * report["world_decisions_per_second"]
