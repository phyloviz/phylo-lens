from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import psutil

from phylo_lens_eval.common import (
    validate_manifest,
    validate_observation,
    wait_with_peak_rss,
)
from phylo_lens_eval.stats import summarize_observations


def test_summary_excludes_warmups_and_retains_failures() -> None:
    summary = summarize_observations(
        [
            {
                "warmup": True,
                "state": "success",
                "wall_time_seconds": 99.0,
                "stage_durations_seconds": {},
            },
            {
                "warmup": False,
                "state": "success",
                "wall_time_seconds": 1.0,
                "stage_durations_seconds": {"base_layout": 0.5},
            },
            {
                "warmup": False,
                "state": "failed",
                "wall_time_seconds": 2.0,
                "stage_durations_seconds": {},
            },
            {
                "warmup": False,
                "state": "success",
                "wall_time_seconds": 3.0,
                "stage_durations_seconds": {"base_layout": 1.5},
            },
        ]
    )
    assert summary["count"] == 3
    assert summary["successful_count"] == 2
    assert summary["failed_count"] == 1
    assert summary["metrics"]["wall_time_seconds"]["median"] == 2.0
    assert summary["stage_durations_seconds"]["base_layout"]["median"] == 1.0


def test_timeout_terminates_child_process_tree(tmp_path: Path) -> None:
    child_pid_path = tmp_path / "descendant.pid"
    process = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import pathlib, subprocess, sys, time; "
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)']); "
            f"pathlib.Path({str(child_pid_path)!r}).write_text(str(child.pid)); time.sleep(10)",
        ],
        start_new_session=True,
    )
    deadline = time.monotonic() + 2
    while not child_pid_path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    descendant_pid = int(child_pid_path.read_text(encoding="utf-8"))
    _peak_rss, timed_out, _scope = wait_with_peak_rss(process, 0.05)
    assert timed_out is True
    assert process.returncode is not None
    deadline = time.monotonic() + 2
    while psutil.pid_exists(descendant_pid) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert psutil.pid_exists(descendant_pid) is False


def test_tiny_end_to_end_direct_tree_preparation_validates_raw_artifacts(
    tmp_path: Path,
) -> None:
    root = Path(__file__).resolve().parents[2]
    command = [
        sys.executable,
        "-m",
        "phylo_lens_eval.rq1",
        "--experiment",
        "rq1-direct-tree",
        "--dataset",
        "small-balanced-newick",
        "--warmups",
        "0",
        "--repetitions",
        "1",
        "--timeout-seconds",
        "30",
        "--results-root",
        str(tmp_path),
    ]
    completed = subprocess.run(
        command,
        cwd=root,
        env={**os.environ, "PYTHONPATH": f"{root}/eval/src:{root}/code/server/src"},
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    observation_files = list(
        tmp_path.glob(
            "rq1-direct-tree/*/datasets/small-balanced-newick/repetitions/measured-001/observation.json"
        )
    )
    assert len(observation_files) == 1
    observation = json.loads(observation_files[0].read_text(encoding="utf-8"))
    validate_observation(observation)
    run_directory = observation_files[0].parents[4]
    validate_manifest(json.loads((run_directory / "manifest.json").read_text()))
    validate_manifest(
        json.loads(
            (run_directory / "datasets/small-balanced-newick/manifest.json").read_text()
        )
    )
    for line in (
        (run_directory / "observations.jsonl").read_text(encoding="utf-8").splitlines()
    ):
        validate_observation(json.loads(line))
