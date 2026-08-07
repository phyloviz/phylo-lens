"""Run RQ1 direct-tree preparation measurements in isolated child processes.

RQ: RQ1 server-side preparation scalability.
Command: ``PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq1 --experiment rq1-direct-tree``.
Parameters: experiment id, optional dataset id, repetitions, warm-ups, timeout, and results root.
Initial state: Python dependencies from ``eval/pyproject.toml`` and server dependencies are installed.
Timing: child wall time covers parse/normalization through SQLite publication; parent measures RSS.
Output: an isolated run directory containing manifest, resolved config, observations, logs, and summary.
Assumptions: direct Newick input and SQLite persistence. Typing profiles are deliberately not executed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from . import SCHEMA_VERSION
from .common import (
    RSS_SAMPLE_INTERVAL_SECONDS,
    checksum_sha256,
    classify_failure,
    create_isolated_run_directory,
    new_run_id,
    safe_filename,
    utc_now,
    validate_manifest,
    validate_observation,
    wait_with_peak_rss,
    write_json,
)
from .config import (
    ConfigurationError,
    DatasetConfig,
    load_datasets,
    load_experiments,
    resolve_experiment,
)
from .environment import capture_environment
from .stats import summarize_observations


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run isolated PhyloLens RQ1 direct-tree preparations."
    )
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--dataset", action="append", dest="dataset_ids")
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--timeout-seconds", type=float)
    parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    try:
        run(args)
    except ConfigurationError as error:
        parser.error(str(error))


def run(args: argparse.Namespace) -> Path:
    root = repository_root()
    datasets = load_datasets(root / "eval/config/datasets.json", root)
    experiment = resolve_experiment(
        args.experiment,
        load_experiments(root / "eval/config/experiments.json"),
        datasets,
    )
    selected_ids = tuple(args.dataset_ids or experiment.dataset_ids)
    if not selected_ids or any(
        dataset_id not in datasets for dataset_id in selected_ids
    ):
        unknown = sorted(set(selected_ids) - set(datasets))
        raise ConfigurationError(f"Unknown dataset id(s): {', '.join(unknown)}.")
    warmups = experiment.warmup_repetitions if args.warmups is None else args.warmups
    repetitions = (
        experiment.measured_repetitions
        if args.repetitions is None
        else args.repetitions
    )
    timeout = (
        experiment.timeout_seconds
        if args.timeout_seconds is None
        else args.timeout_seconds
    )
    if not isinstance(warmups, int) or warmups < 0:
        raise ConfigurationError("--warmups must be a non-negative integer.")
    if not isinstance(repetitions, int) or repetitions < 1:
        raise ConfigurationError("--repetitions must be a positive integer.")
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise ConfigurationError("--timeout-seconds must be greater than zero.")
    results_root = (args.results_root or root / "eval/results/raw").resolve()
    run_id = new_run_id()
    environment = capture_environment(root)
    run_dir = create_isolated_run_directory(results_root, experiment.id, run_id)
    resolved = {
        "experiment_id": experiment.id,
        "dataset_ids": list(selected_ids),
        "warmup_repetitions": warmups,
        "measured_repetitions": repetitions,
        "timeout_seconds": timeout,
        "persistence_backend": experiment.persistence_backend,
        "peak_rss_sampling_interval_seconds": RSS_SAMPLE_INTERVAL_SECONDS,
    }
    all_observations: list[dict] = []
    batch_manifest = _batch_manifest(
        experiment.id, run_id, selected_ids, resolved, environment
    )
    write_json(run_dir / "resolved-config.json", resolved)
    write_json(run_dir / "manifest.json", batch_manifest)
    for dataset_id in selected_ids:
        dataset = datasets[dataset_id]
        manifest = _manifest(
            experiment.id, run_id, dataset, resolved, root, environment, state="running"
        )
        dataset_dir = run_dir / "datasets" / safe_filename(dataset_id)
        dataset_dir.mkdir(parents=True)
        write_json(dataset_dir / "manifest.json", manifest)
        write_json(dataset_dir / "resolved-config.json", resolved)
        for index in range(warmups + repetitions):
            observation = _run_observation(
                dataset, dataset_dir, index, index < warmups, timeout, root
            )
            all_observations.append(observation)
            with (dataset_dir / "observations.jsonl").open(
                "a", encoding="utf-8"
            ) as stream:
                stream.write(json.dumps(observation, sort_keys=True) + "\n")
            with (run_dir / "observations.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(observation, sort_keys=True) + "\n")
        manifest["state"] = (
            "completed"
            if all(
                item["state"] == "success"
                for item in all_observations
                if item["dataset_id"] == dataset_id
            )
            else "failed"
        )
        validate_manifest(manifest)
        write_json(dataset_dir / "manifest.json", manifest)
        write_json(
            dataset_dir / "summary.json",
            summarize_observations(
                [item for item in all_observations if item["dataset_id"] == dataset_id]
            ),
        )
    write_json(
        run_dir / "summary.json",
        {
            "schema_version": SCHEMA_VERSION,
            "datasets": {
                dataset_id: summarize_observations(
                    [
                        item
                        for item in all_observations
                        if item["dataset_id"] == dataset_id
                    ]
                )
                for dataset_id in selected_ids
            },
        },
    )
    batch_manifest["state"] = (
        "completed"
        if all(item["state"] == "success" for item in all_observations)
        else "failed"
    )
    validate_manifest(batch_manifest)
    write_json(run_dir / "manifest.json", batch_manifest)
    return run_dir


def _manifest(
    experiment_id: str,
    run_id: str,
    dataset: DatasetConfig,
    resolved: dict,
    root: Path,
    environment: dict,
    *,
    state: str,
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": experiment_id,
        "run_id": run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": {
            key: value for key, value in environment.items() if key != "git"
        },
        "dataset": {
            "id": dataset.id,
            "path": str(dataset.path.relative_to(root)),
            "checksum_sha256": checksum_sha256(dataset.path),
            "format": dataset.format,
            "topology": dataset.topology,
            "declared_node_count": dataset.declared_node_count,
            "declared_edge_count": dataset.declared_edge_count,
        },
        "parameters": resolved,
        "state": state,
    }


def _batch_manifest(
    experiment_id: str,
    run_id: str,
    dataset_ids: tuple[str, ...],
    resolved: dict,
    environment: dict,
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": experiment_id,
        "run_id": run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": {
            key: value for key, value in environment.items() if key != "git"
        },
        "dataset": {"id": dataset_ids[0] if len(dataset_ids) == 1 else "multiple"},
        "dataset_ids": list(dataset_ids),
        "parameters": resolved,
        "state": "running",
    }


def _run_observation(
    dataset: DatasetConfig,
    dataset_dir: Path,
    index: int,
    warmup: bool,
    timeout: float,
    root: Path,
) -> dict:
    observation_id = f"{'warmup' if warmup else 'measured'}-{index + 1:03d}"
    child_dir = dataset_dir / "repetitions" / observation_id
    persistence_dir = child_dir / "persistence"
    request_path, output_path = (
        child_dir / "request.json",
        child_dir / "observation.json",
    )
    write_json(
        request_path,
        {
            "dataset_id": dataset.id,
            "dataset_path": str(dataset.path),
            "dataset_format": dataset.format,
            "declared_node_count": dataset.declared_node_count,
            "declared_edge_count": dataset.declared_edge_count,
            "persistence_dir": str(persistence_dir),
            "observation_id": observation_id,
            "warmup": warmup,
        },
    )
    command = [
        sys.executable,
        "-m",
        "phylo_lens_eval.child",
        "--request",
        str(request_path),
        "--output",
        str(output_path),
    ]
    environment = os.environ.copy()
    source_paths = [str(root / "eval/src"), str(root / "code/server/src")]
    environment["PYTHONPATH"] = os.pathsep.join(
        source_paths
        + ([environment["PYTHONPATH"]] if environment.get("PYTHONPATH") else [])
    )
    with (
        (child_dir / "stdout.log").open("w", encoding="utf-8") as stdout,
        (child_dir / "stderr.log").open("w", encoding="utf-8") as stderr,
    ):
        process = subprocess.Popen(
            command,
            cwd=root,
            env=environment,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
        peak_rss, timed_out, peak_rss_scope = wait_with_peak_rss(process, timeout)
    if output_path.is_file():
        observation = json.loads(output_path.read_text(encoding="utf-8"))
    else:
        observation = {
            "schema_version": SCHEMA_VERSION,
            "observation_id": observation_id,
            "dataset_id": dataset.id,
            "warmup": warmup,
            "state": "failed",
            "failure_classification": classify_failure(process.returncode, timed_out),
            "wall_time_seconds": None,
            "stage_durations_seconds": {},
            "warnings": [],
            "exit_status": process.returncode,
            "error": "Child process did not produce an observation.",
            "peak_rss_bytes": peak_rss,
            "peak_rss_scope": peak_rss_scope,
        }
    if timed_out:
        observation.update(
            {
                "state": "failed",
                "failure_classification": "timeout",
                "error": f"Preparation exceeded timeout of {timeout} seconds.",
                "exit_status": process.returncode,
            }
        )
    observation["dataset_id"] = dataset.id
    observation["peak_rss_bytes"] = peak_rss
    observation["peak_rss_scope"] = peak_rss_scope
    if observation.get("state") == "success":
        observation["exit_status"] = process.returncode
    validate_observation(observation)
    write_json(output_path, observation)
    return observation


if __name__ == "__main__":
    main()
