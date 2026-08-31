"""Isolated RQ2 browser evaluation orchestration.

RQ2 measures the public PhyloLens browser lifecycle only.  Python owns run
directories, manifests, RSS sampling, observation validation, and summaries;
the Node child owns the bounded replay/page/Chromium interaction.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

from .. import SCHEMA_VERSION
from ..core.common import (
    create_isolated_run_directory,
    new_run_id,
    utc_now,
    validate_manifest,
    validate_rq2_observation,
    write_json,
)
from ..core.environment import capture_environment
from ..core.stats import percentile, summary

FAILURE_KINDS = {
    "none",
    "invalid_configuration",
    "fixture_generation_failure",
    "replay_contract_failure",
    "browser_launch_failure",
    "runtime_state_timeout",
    "bootstrap_failure",
    "client_load_failure",
    "render_timeout",
    "empty_visual_output",
    "unexpected_network_request",
    "unexpected_viewport_request",
    "process_monitor_failure",
    "browser_crash",
    "harness_protocol_failure",
    "insufficient_frame_samples",
}


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run isolated PhyloLens RQ2 browser observations."
    )
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--timeout-seconds", type=float)
    parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    try:
        print(run(args))
    except ValueError as error:
        parser.error(str(error))


def run(args: argparse.Namespace) -> Path:
    root = repository_root()
    experiment = load_rq2_experiment(
        root / "eval/config/rq2-experiments.json", args.experiment
    )
    warmups = experiment["warmup_repetitions"] if args.warmups is None else args.warmups
    repetitions = (
        experiment["measured_repetitions"]
        if args.repetitions is None
        else args.repetitions
    )
    timeout = (
        experiment["timeout_seconds"]
        if args.timeout_seconds is None
        else args.timeout_seconds
    )
    if not isinstance(warmups, int) or warmups < 0:
        raise ValueError("--warmups must be a non-negative integer.")
    if not isinstance(repetitions, int) or repetitions < 1:
        raise ValueError("--repetitions must be a positive integer.")
    if not isinstance(timeout, (float, int)) or timeout <= 0:
        raise ValueError("--timeout-seconds must be greater than zero.")
    _validate_browser_prerequisites(root)

    run_id = new_run_id()
    results_root = (args.results_root or root / "eval/results/raw").resolve()
    run_dir = create_isolated_run_directory(results_root, experiment["id"], run_id)
    resolved = {
        **experiment,
        "warmup_repetitions": warmups,
        "measured_repetitions": repetitions,
        "timeout_seconds": float(timeout),
    }
    environment = capture_environment(root)
    manifest = _manifest(experiment, run_id, resolved, environment, state="running")
    validate_manifest(manifest)
    write_json(run_dir / "resolved-config.json", resolved)
    write_json(run_dir / "manifest.json", manifest)

    observations: list[dict[str, Any]] = []
    for fixture in experiment["fixtures"]:
        for index in range(warmups + repetitions):
            warmup = index < warmups
            observation = _run_repetition(
                root, run_dir, experiment, fixture, index, warmup, float(timeout)
            )
            observations.append(observation)
            _append_jsonl(run_dir / "observations.jsonl", observation)
    write_json(run_dir / "summary.json", summarize_rq2_observations(observations))
    manifest["state"] = (
        "completed"
        if all(row["status"] == "success" for row in observations)
        else "failed"
    )
    manifest["rq2"]["observed_browser_versions"] = sorted(
        {row["browser"]["version"] for row in observations if row["browser"]["version"]}
    )
    manifest["rq2"]["fixture_checksums"] = sorted(
        {row["fixture"]["checksum_sha256"] for row in observations}
    )
    manifest["rq2"]["browser_executables"] = sorted(
        {
            row["browser"]["executable_path"]
            for row in observations
            if row["browser"]["executable_path"]
        }
    )
    validate_manifest(manifest)
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def load_rq2_experiment(path: Path, experiment_id: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read RQ2 configuration: {error}") from error
    if payload.get("schema_version") != "1" or not isinstance(
        payload.get("experiments"), list
    ):
        raise ValueError(
            "RQ2 configuration must contain schema_version '1' and experiments."
        )
    matching = [
        item for item in payload["experiments"] if item.get("id") == experiment_id
    ]
    if len(matching) != 1:
        raise ValueError(f"Unknown or duplicate RQ2 experiment '{experiment_id}'.")
    experiment = matching[0]
    required = (
        "id",
        "research_question",
        "warmup_repetitions",
        "measured_repetitions",
        "timeout_seconds",
        "quiescence_ms",
        "animation_duration_ms",
        "frame_budget_ms",
        "minimum_frame_sample_count",
        "rss_sampling_interval_seconds",
        "browser",
        "input",
        "fixtures",
    )
    if (
        any(key not in experiment for key in required)
        or experiment["research_question"] != "RQ2"
    ):
        raise ValueError("RQ2 experiment is missing required RQ2 fields.")
    if not isinstance(experiment["fixtures"], list) or not experiment["fixtures"]:
        raise ValueError("RQ2 experiment requires at least one synthetic fixture.")
    for fixture in experiment["fixtures"]:
        if (
            not isinstance(fixture.get("node_count"), int)
            or fixture["node_count"] < 1
            or not isinstance(fixture.get("triangle_count"), int)
            or not 0 <= fixture["triangle_count"] <= fixture["node_count"]
        ):
            raise ValueError(
                "RQ2 fixture counts must be non-negative and internally consistent."
            )
        if not isinstance(fixture.get("seed"), int) or not isinstance(
            fixture.get("labels_enabled"), bool
        ):
            raise ValueError(
                "RQ2 fixtures require integer seed and boolean labels_enabled."
            )
    browser = experiment["browser"]
    if not isinstance(browser.get("headless"), bool) or not isinstance(
        browser.get("viewport"), dict
    ):
        raise ValueError("RQ2 browser configuration is invalid.")
    if (
        any(
            not isinstance(experiment[key], (int, float)) or experiment[key] <= 0
            for key in (
                "timeout_seconds",
                "quiescence_ms",
                "animation_duration_ms",
                "frame_budget_ms",
                "rss_sampling_interval_seconds",
            )
        )
        or not isinstance(experiment["minimum_frame_sample_count"], int)
        or experiment["minimum_frame_sample_count"] < 1
    ):
        raise ValueError("RQ2 timing configuration must be positive.")
    input_config = experiment["input"]
    required_input = (
        "drag_dx",
        "drag_dy",
        "drag_steps",
        "step_delay_ms",
        "zoom_in_delta_y",
        "zoom_out_delta_y",
        "wheel_delay_ms",
    )
    if (
        not isinstance(input_config, dict)
        or any(key not in input_config for key in required_input)
        or not isinstance(input_config["drag_steps"], int)
        or input_config["drag_steps"] < 1
        or any(
            not isinstance(input_config[key], (int, float))
            for key in required_input
            if key != "drag_steps"
        )
        or input_config["step_delay_ms"] < 0
        or input_config["wheel_delay_ms"] < 0
    ):
        raise ValueError("RQ2 requires a valid fixed input sequence.")
    return experiment


def _validate_browser_prerequisites(root: Path) -> None:
    if shutil.which("node") is None:
        raise ValueError("Node.js is required for RQ2.")
    for path in (
        root / "code/client/dist/index.js",
        root / "eval/browser/dist/index.html",
    ):
        if not path.is_file():
            raise ValueError(
                f"Built browser prerequisite is missing: {path}. Build the client library and eval/browser first."
            )


def _run_repetition(
    root: Path,
    run_dir: Path,
    experiment: dict,
    fixture: dict,
    index: int,
    warmup: bool,
    timeout: float,
) -> dict:
    observation_id = f"{'warmup' if warmup else 'measured'}-{index + 1:03d}"
    repetition_dir = run_dir / "repetitions" / safe_path(fixture["id"]) / observation_id
    request_path = repetition_dir / "request.json"
    result_path = repetition_dir / "browser-result.json"
    runtime_state_path = repetition_dir / "runtime-state.json"
    phase_ack_path = repetition_dir / "phase-ack.json"
    paths = {
        "request": request_path,
        "runtime_state": runtime_state_path,
        "phase_ack": phase_ack_path,
        "browser_result": result_path,
        "frame_samples": repetition_dir / "frame-samples.json",
        "request_samples": repetition_dir / "request-samples.json",
        "stdout": repetition_dir / "stdout.jsonl",
        "stderr": repetition_dir / "stderr.log",
        "replay_access_log": repetition_dir / "replay-access-log.json",
        "screenshot": repetition_dir / "screenshot.png",
    }
    browser = experiment["browser"]
    request = {
        "fixture": {
            "id": fixture["id"],
            "nodeCount": fixture["node_count"],
            "triangleCount": fixture["triangle_count"],
            "seed": fixture["seed"],
            "labelsEnabled": fixture["labels_enabled"],
            "generatorVersion": fixture.get("generator_version"),
            "response": fixture.get("response"),
        },
        "browser": browser,
        "browser_dist_path": str(root / "eval/browser/dist"),
        "runtime_state_path": str(runtime_state_path),
        "phase_ack_path": str(phase_ack_path),
        "screenshot_path": str(paths["screenshot"]),
        "frame_samples_path": str(paths["frame_samples"]),
        "request_samples_path": str(paths["request_samples"]),
        "replay_access_log_path": str(paths["replay_access_log"]),
        "quiescence_ms": experiment["quiescence_ms"],
        "animation_duration_ms": experiment["animation_duration_ms"],
        "frame_budget_ms": experiment["frame_budget_ms"],
        "minimum_frame_sample_count": experiment["minimum_frame_sample_count"],
        "input": experiment["input"],
    }
    write_json(request_path, request)
    command = [
        "node",
        str(root / "eval/browser/src/runner.mjs"),
        str(request_path),
        str(result_path),
    ]
    runtime, monitor = _run_node_and_monitor(
        command, root, paths, timeout, experiment["rss_sampling_interval_seconds"]
    )
    node_result = _read_single_node_result(paths["stdout"], result_path)
    observation = _observation_from_result(
        experiment,
        fixture,
        observation_id,
        index,
        warmup,
        node_result,
        runtime,
        monitor,
        paths,
    )
    validate_rq2_observation(observation)
    write_json(repetition_dir / "observation.json", observation)
    return observation


def _run_node_and_monitor(
    command: list[str],
    root: Path,
    paths: dict[str, Path],
    timeout: float,
    interval: float,
) -> tuple[dict | None, dict]:
    runtime: dict | None = None
    monitor = {
        "scope": "process_tree",
        "baseline_rss_bytes": None,
        "post_render_rss_bytes": None,
        "maximum_rss_bytes": None,
        "process_monitor_failed": False,
        "acknowledged_phases": set(),
        "load_render_samples": [],
    }
    with (
        paths["stdout"].open("w", encoding="utf-8") as stdout,
        paths["stderr"].open("w", encoding="utf-8") as stderr,
    ):
        process = subprocess.Popen(
            command, cwd=root, stdout=stdout, stderr=stderr, start_new_session=True
        )
        deadline = time.monotonic() + timeout
        runtime_deadline = time.monotonic() + min(10.0, timeout)
        browser_process: psutil.Process | None = None
        while process.poll() is None:
            if runtime is None and paths["runtime_state"].is_file():
                try:
                    runtime = json.loads(
                        paths["runtime_state"].read_text(encoding="utf-8")
                    )
                    browser_process = _find_chromium_root(
                        psutil.Process(int(runtime["browser_pid"]))
                    )
                except (
                    OSError,
                    ValueError,
                    KeyError,
                    json.JSONDecodeError,
                    psutil.Error,
                ):
                    # The state file is atomically replaced; retry until the runtime deadline.
                    runtime = None
            elif runtime is not None and paths["runtime_state"].is_file():
                try:
                    runtime = json.loads(
                        paths["runtime_state"].read_text(encoding="utf-8")
                    )
                except (OSError, json.JSONDecodeError):
                    pass
            if browser_process is not None and runtime is not None:
                rss, scope = _sample_browser_tree(browser_process)
                monitor["scope"] = scope
                phase = runtime.get("phase")
                sequence = runtime.get("phase_sequence")
                if (
                    phase in {"baseline", "post_render"}
                    and isinstance(sequence, int)
                    and sequence not in monitor["acknowledged_phases"]
                ):
                    if rss is None:
                        monitor["process_monitor_failed"] = True
                    elif phase == "baseline":
                        monitor["baseline_rss_bytes"] = rss
                    else:
                        monitor["post_render_rss_bytes"] = rss
                    if rss is not None:
                        write_json(
                            paths["phase_ack"],
                            {
                                "phase": phase,
                                "phase_sequence": sequence,
                                "sampled_monotonic_seconds": time.monotonic(),
                            },
                        )
                        monitor["acknowledged_phases"].add(sequence)
                elif phase == "load_render":
                    if rss is None:
                        monitor["process_monitor_failed"] = True
                    else:
                        monitor["load_render_samples"].append(rss)
            if runtime is None and time.monotonic() >= runtime_deadline:
                _terminate_process_group(process)
                monitor["runtime_state_timeout"] = True
                break
            if time.monotonic() >= deadline:
                _terminate_process_group(process)
                monitor["timed_out"] = True
                break
            time.sleep(interval)
        process.wait()
        monitor["exit_status"] = process.returncode
    if runtime is None and not monitor.get("runtime_state_timeout"):
        monitor["runtime_state_timeout"] = not monitor.get("timed_out", False)
    monitor["maximum_rss_bytes"] = _load_render_peak(monitor.pop("load_render_samples"))
    if runtime is not None and (
        monitor["baseline_rss_bytes"] is None
        or monitor["post_render_rss_bytes"] is None
        or monitor["maximum_rss_bytes"] is None
    ):
        monitor["process_monitor_failed"] = True
    return runtime, monitor


def _sample_browser_tree(root: psutil.Process) -> tuple[int | None, str]:
    try:
        related = [root, *root.children(recursive=True)]
        live = [
            item
            for item in related
            if item.is_running() and item.status() != psutil.STATUS_ZOMBIE
        ]
        return sum(item.memory_info().rss for item in live), "process_tree"
    except (psutil.Error, PermissionError, ValueError):
        try:
            return root.memory_info().rss, "root_only"
        except (psutil.Error, PermissionError):
            return None, "root_only"


def _find_chromium_root(launcher: psutil.Process) -> psutil.Process:
    """Resolve Playwright's Node launch-server PID to Chromium's browser root."""
    candidates = [launcher, *launcher.children(recursive=True)]
    chromium = []
    for process in candidates:
        try:
            name = process.name().lower()
            executable = process.exe().lower()
        except (psutil.Error, PermissionError):
            continue
        if ("chromium" in name or "chromium" in executable) and "helper" not in name:
            chromium.append(process)
    if not chromium:
        raise ValueError("Playwright launch-server PID has no live Chromium descendant")
    # The browser root is the Chromium candidate nearest the Node launcher.
    return min(chromium, key=lambda process: len(process.parents()))


def _load_render_peak(samples: list[int]) -> int | None:
    """Return a peak exclusively from samples captured while phase=load_render."""
    return max(samples) if samples else None


def _terminate_process_group(process: subprocess.Popen) -> None:
    if os.name != "nt":
        os.killpg(process.pid, signal.SIGKILL)
    else:  # pragma: no cover
        process.kill()


def _read_single_node_result(stdout_path: Path, result_path: Path) -> dict | None:
    lines = [
        line
        for line in stdout_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(lines) != 1:
        return None
    try:
        payload = json.loads(lines[0])
    except json.JSONDecodeError:
        return None
    if result_path.is_file():
        try:
            if json.loads(result_path.read_text(encoding="utf-8")) != payload:
                return None
        except json.JSONDecodeError:
            return None
    return payload


def _observation_from_result(
    experiment: dict,
    fixture_config: dict,
    observation_id: str,
    index: int,
    warmup: bool,
    result: dict | None,
    runtime: dict | None,
    monitor: dict,
    paths: dict[str, Path],
) -> dict:
    browser_config = experiment["browser"]
    if result is None:
        status = "timeout" if monitor.get("timed_out") else "failure"
        failure_kind = (
            "runtime_state_timeout"
            if monitor.get("runtime_state_timeout")
            else "harness_protocol_failure"
        )
        result = {}
    else:
        status = result.get("status", "failure")
        failure_kind = result.get("failure_kind", "harness_protocol_failure")
        if status == "success" and not _valid_first_render_timing(
            result.get("timing", {})
        ):
            status, failure_kind = "failure", "harness_protocol_failure"
    if status not in {"success", "invalid", "timeout", "failure", "unsupported_metric"}:
        status, failure_kind = "failure", "harness_protocol_failure"
    if failure_kind not in FAILURE_KINDS:
        failure_kind = "harness_protocol_failure"
    node_fixture = result.get("fixture", {})
    fixture = {
        "id": node_fixture.get("id", fixture_config["id"]),
        "generator_version": node_fixture.get("generator_version", "unavailable"),
        "random_seed": node_fixture.get("random_seed", fixture_config["seed"]),
        "checksum_sha256": node_fixture.get("checksum_sha256", "0" * 64),
        "node_count": node_fixture.get("node_count", fixture_config["node_count"]),
        "edge_count": node_fixture.get(
            "edge_count", max(0, fixture_config["node_count"] - 1)
        ),
        "triangle_count": node_fixture.get(
            "triangle_count", fixture_config["triangle_count"]
        ),
        "total_primitive_count": node_fixture.get(
            "total_primitive_count",
            fixture_config["node_count"]
            + max(0, fixture_config["node_count"] - 1)
            + fixture_config["triangle_count"],
        ),
        "bounds": node_fixture.get(
            "bounds", {"min_x": -1, "max_x": 1, "min_y": -1, "max_y": 1}
        ),
        "labels_enabled": fixture_config["labels_enabled"],
        "metadata_configuration": node_fixture.get(
            "metadata_configuration",
            fixture_config.get("metadata_configuration", "none"),
        ),
        "api_contract_version": node_fixture.get("api_schema_version", "1"),
    }
    heap = result.get("heap", _unavailable_heap("Node result unavailable"))
    deltas = _heap_deltas(heap)
    frame = frame_statistics(
        result.get("frame_intervals_ms", []), experiment["frame_budget_ms"]
    )
    baseline = monitor.get("baseline_rss_bytes")
    post = monitor.get("post_render_rss_bytes")
    maximum = monitor.get("maximum_rss_bytes")
    if status == "success" and (
        monitor.get("process_monitor_failed")
        or baseline is None
        or post is None
        or maximum is None
    ):
        status, failure_kind = "failure", "process_monitor_failure"
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": experiment["id"],
        "observation_id": observation_id,
        "warmup": warmup,
        "repetition_index": index,
        "status": status,
        "failure_kind": failure_kind,
        "fixture": fixture,
        "browser": {
            "version": (runtime or {}).get("browser_version"),
            "executable_path": (runtime or {}).get("browser_executable_path"),
            "headless": browser_config["headless"],
            "viewport": browser_config["viewport"],
            "device_scale_factor": browser_config["device_scale_factor"],
            "locale": browser_config["locale"],
            "timezone": browser_config["timezone"],
            "launch_args": browser_config["launch_args"],
        },
        "timing": {
            key: result.get("timing", {}).get(key)
            for key in (
                "load_to_snapshot_applied_ms",
                "load_to_post_update_frame_ms",
                "snapshot_applied_to_frame_ms",
            )
        },
        "heap": {
            "baseline": heap.get("baseline", _unavailable_heap("Not captured")),
            "post_render": heap.get("post_render", _unavailable_heap("Not captured")),
            "delta": deltas,
        },
        "rss": {
            "sampling_interval_seconds": experiment["rss_sampling_interval_seconds"],
            "scope": monitor.get("scope", "root_only"),
            "baseline_rss_bytes": baseline,
            "post_render_rss_bytes": post,
            "maximum_rss_bytes": maximum,
            "post_render_delta_bytes": _delta(post, baseline),
            "peak_delta_bytes": _delta(maximum, baseline),
        },
        "frame_statistics": {
            **frame,
            "frame_budget_ms": experiment["frame_budget_ms"],
            "minimum_sample_count": experiment["minimum_frame_sample_count"],
        },
        "artifacts": {key: str(path) for key, path in paths.items()},
        "replay": {
            "request_count": result.get("replay_request_count", 0),
            "post_initial_viewport_request_count": result.get(
                "post_initial_viewport_request_count", 0
            ),
            "input_record": result.get("input_record"),
        },
        "warnings": [
            "embedder and backing-storage heap values are explicitly unavailable when CDP does not expose them."
        ],
        "error": None
        if status == "success"
        else result.get("message", "Node child did not produce a valid observation."),
    }


def _metric(state: str, bytes_value: int | None, reason: str | None) -> dict:
    return {"state": state, "bytes": bytes_value, "reason": reason}


def _unavailable_heap(reason: str) -> dict:
    return {
        name: _metric("unavailable", None, reason)
        for name in (
            "js_heap_used_bytes",
            "js_heap_total_bytes",
            "embedder_heap_used_bytes",
            "backing_storage_bytes",
        )
    }


def _heap_deltas(heap: dict) -> dict:
    baseline = heap.get("baseline", _unavailable_heap("Not captured"))
    post = heap.get("post_render", _unavailable_heap("Not captured"))
    output = {}
    for name in baseline:
        before, after = baseline[name], post.get(name, {})
        if before.get("state") == after.get("state") == "available":
            output[name] = _metric("available", after["bytes"] - before["bytes"], None)
        else:
            output[name] = _metric(
                "unavailable", None, "Metric unavailable at one or both snapshots"
            )
    return output


def _delta(after: int | None, before: int | None) -> int | None:
    return None if after is None or before is None else after - before


def _valid_first_render_timing(timing: dict) -> bool:
    values = [timing.get(key) for key in ("t0_ms", "t1_ms", "t2_ms")]
    return (
        all(
            isinstance(value, (int, float)) and math.isfinite(value) for value in values
        )
        and values[0] <= values[1] <= values[2]
    )


def frame_statistics(values: list[float], budget: float) -> dict:
    valid = sorted(
        float(value)
        for value in values
        if isinstance(value, (int, float)) and value >= 0
    )
    if not valid:
        return {
            "sample_count": 0,
            "median_ms": None,
            "p25_ms": None,
            "p75_ms": None,
            "iqr_ms": None,
            "p95_ms": None,
            "maximum_ms": None,
            "above_frame_budget_count": 0,
            "above_frame_budget_proportion": 0,
            "above_33_3_ms_count": 0,
            "above_33_3_ms_proportion": 0,
            "above_50_ms_count": 0,
            "above_50_ms_proportion": 0,
        }
    p25, p75 = percentile(valid, 0.25), percentile(valid, 0.75)

    def count(threshold: float) -> int:
        return sum(value > threshold for value in valid)

    return {
        "sample_count": len(valid),
        "median_ms": percentile(valid, 0.5),
        "p25_ms": p25,
        "p75_ms": p75,
        "iqr_ms": p75 - p25,
        "p95_ms": percentile(valid, 0.95),
        "maximum_ms": valid[-1],
        "above_frame_budget_count": count(budget),
        "above_frame_budget_proportion": count(budget) / len(valid),
        "above_33_3_ms_count": count(33.3),
        "above_33_3_ms_proportion": count(33.3) / len(valid),
        "above_50_ms_count": count(50),
        "above_50_ms_proportion": count(50) / len(valid),
    }


def summarize_rq2_observations(observations: list[dict]) -> dict:
    measured = [row for row in observations if not row["warmup"]]
    groups: dict[str, list[dict]] = {}
    for row in measured:
        key = json.dumps(
            {
                "fixture_id": row["fixture"]["id"],
                "checksum": row["fixture"]["checksum_sha256"],
                "primitive_counts": {
                    name: row["fixture"][name]
                    for name in (
                        "node_count",
                        "edge_count",
                        "triangle_count",
                        "total_primitive_count",
                    )
                },
                "labels_enabled": row["fixture"]["labels_enabled"],
                "label_configuration": row["fixture"]["metadata_configuration"],
                "browser_version": row["browser"]["version"],
                "headless": row["browser"]["headless"],
                "viewport": row["browser"]["viewport"],
                "device_scale_factor": row["browser"]["device_scale_factor"],
                "frame_budget_ms": row["frame_statistics"].get("frame_budget_ms", None),
                "memory_scope": row["rss"]["scope"],
            },
            sort_keys=True,
        )
        groups.setdefault(key, []).append(row)
    return {
        "schema_version": SCHEMA_VERSION,
        "groups": [
            {"conditions": json.loads(key), **_summarize_group(rows)}
            for key, rows in groups.items()
        ],
    }


def _summarize_group(rows: list[dict]) -> dict:
    success = [row for row in rows if row["status"] == "success"]
    metric_paths = {
        "time_to_first_rendered_viewport_ms": (
            "timing",
            "load_to_post_update_frame_ms",
        ),
        "js_heap_used_delta_bytes": ("heap", "delta", "js_heap_used_bytes", "bytes"),
        "frame_median_ms": ("frame_statistics", "median_ms"),
        "frame_p95_ms": ("frame_statistics", "p95_ms"),
    }
    if rows[0]["rss"]["scope"] == "process_tree":
        metric_paths["rss_peak_delta_bytes"] = ("rss", "peak_delta_bytes")
    return {
        "configured_count": len(rows),
        "success_count": len(success),
        "invalid_count": sum(row["status"] == "invalid" for row in rows),
        "failure_count": sum(row["status"] == "failure" for row in rows),
        "timeout_count": sum(row["status"] == "timeout" for row in rows),
        "metrics": {
            name: summary(
                [value for row in success if (value := _get(row, path)) is not None]
            )
            for name, path in metric_paths.items()
        },
    }


def _get(value: dict, path: tuple[str, ...]) -> Any:
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value if isinstance(value, (int, float)) else None


def _manifest(
    experiment: dict, run_id: str, resolved: dict, environment: dict, *, state: str
) -> dict:
    client_package = json.loads(
        (repository_root() / "code/client/package.json").read_text(encoding="utf-8")
    )
    browser_package = json.loads(
        (repository_root() / "eval/browser/package.json").read_text(encoding="utf-8")
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": experiment["id"],
        "run_id": run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": {
            key: value for key, value in environment.items() if key != "git"
        },
        "dataset": {"id": "synthetic-fixtures"},
        "parameters": {
            "experiment_id": experiment["id"],
            "dataset_ids": [fixture["id"] for fixture in experiment["fixtures"]],
            "warmup_repetitions": resolved["warmup_repetitions"],
            "measured_repetitions": resolved["measured_repetitions"],
            "timeout_seconds": resolved["timeout_seconds"],
            "persistence_backend": "browser",
            "peak_rss_sampling_interval_seconds": resolved[
                "rss_sampling_interval_seconds"
            ],
        },
        "state": state,
        "rq2": {
            "client_package_version": client_package["version"],
            "api_contract_version": environment["phylolens"]["api_contract_version"],
            "node_version": _tool_version(["node", "--version"]),
            "playwright_version": browser_package.get("devDependencies", {}).get(
                "@playwright/test"
            ),
            "browser": resolved["browser"],
            "quiescence_ms": resolved["quiescence_ms"],
            "animation_duration_ms": resolved["animation_duration_ms"],
            "frame_budget_ms": resolved["frame_budget_ms"],
            "minimum_frame_sample_count": resolved["minimum_frame_sample_count"],
            "input": resolved["input"],
            "rss_sampling_interval_seconds": resolved["rss_sampling_interval_seconds"],
            "fixture_checksums": [],
            "observed_browser_versions": [],
            "browser_executables": [],
        },
    }


def _tool_version(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            command, text=True, capture_output=True, timeout=10, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return completed.stdout.strip() or completed.stderr.strip() or None


def _append_jsonl(path: Path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, sort_keys=True) + "\n")


def safe_path(value: str) -> str:
    return "".join(
        character if character.isalnum() or character in "._-" else "-"
        for character in value
    )


if __name__ == "__main__":
    main()
