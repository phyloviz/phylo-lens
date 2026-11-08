"""Bound a genuine registry deadlock without relying on fork or queue polling."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def immediate_future_case(kind: str) -> dict:
    server_root = Path(__file__).resolve().parents[2]
    environment = {**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)}
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "tests.support.registry_case", kind],
            cwd=server_root,
            env=environment,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        pytest.fail(
            f"Immediate {kind} Future did not complete within the process deadline. "
            f"stdout={error.stdout!r}; stderr={error.stderr!r}"
        )
    assert completed.returncode == 0, (
        f"Immediate {kind} Future child exited {completed.returncode}. "
        f"stdout={completed.stdout!r}; stderr={completed.stderr!r}"
    )
    return json.loads(completed.stdout)
