"""Final RQ2 isolated client-side visualization scalability microbenchmark.

This intentionally uses a deterministic loopback API fixture.  It measures the
released public browser client's materialized visual working set, not PhyloLens
server preparation, real viewport selection, or interaction latency.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

from ... import SCHEMA_VERSION
from ...core.common import (
    create_isolated_run_directory,
    utc_now,
    validate_rq2_final_observation,
    write_json,
)
from ...core.environment import capture_environment
from ...core.stats import percentile, summary

EXPERIMENT_ID = "rq2-client-final-v020"
PRODUCT_RELEASE_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"
PRODUCT_RELEASE_VERSION = "0.2.0"
FINAL_RUN_ID_PATTERN = re.compile(r"^thesis-final-rq2-v020-[0-9]{3}$")
DEVELOPMENT_RUN_ID_PATTERN = re.compile(r"^dev-rq2-final-[a-z0-9-]+$")
FAILURE_KINDS = {
    "none",
    "invalid_configuration",
    "browser_launch_failure",
    "gpu_preflight_failure",
    "runtime_state_timeout",
    "client_load_failure",
    "render_timeout",
    "timeout",
    "request_pattern_failure",
    "snapshot_fixture_mismatch",
    "unexpected_truncation",
    "fixture_integrity_failure",
    "harness_protocol_failure",
    "browser_crash",
}
RSS_INTERVAL_SECONDS = 0.02


def repository_root() -> Path:
    return Path(__file__).resolve().parents[5]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run final isolated RQ2 browser observations."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--results-root", type=Path)
    parser.add_argument("--condition", action="append", dest="conditions")
    args = parser.parse_args()
    try:
        print(run(args))
    except ValueError as error:
        parser.error(str(error))


def load_final_experiment(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read RQ2 configuration: {error}") from error
    matches = [
        item
        for item in payload.get("experiments", [])
        if item.get("id") == EXPERIMENT_ID
    ]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {EXPERIMENT_ID} configuration.")
    experiment = matches[0]
    _validate_final_experiment(experiment)
    return experiment


def _validate_final_experiment(experiment: dict[str, Any]) -> None:
    if experiment.get("research_question") != "RQ2":
        raise ValueError("Final RQ2 configuration must identify RQ2.")
    if (
        experiment.get("warmup_repetitions") != 1
        or experiment.get("measured_repetitions") != 5
    ):
        raise ValueError(
            "Final RQ2 repetition policy is exactly one warm-up and five measured observations."
        )
    if experiment.get("timeout_seconds") != 45:
        raise ValueError("Final RQ2 outer observation timeout is exactly 45 seconds.")
    if (
        not isinstance(experiment.get("global_prepared_node_count"), int)
        or experiment["global_prepared_node_count"] <= 6000
    ):
        raise ValueError(
            "Final RQ2 global prepared-node count must be a fixed value above 6000."
        )
    if experiment.get("max_nodes") != 100000:
        raise ValueError("Final RQ2 maxNodes must be 100000.")
    browser = experiment.get("browser", {})
    if browser != {
        "headless": False,
        "viewport": {"width": 960, "height": 640},
        "device_scale_factor": 1,
        "locale": "en-US",
        "timezone": "UTC",
        "launch_args": [],
    }:
        raise ValueError(
            "Final RQ2 browser policy differs from the frozen headed 960x640/DPR1 policy."
        )
    stress = experiment.get("frame_stress", {})
    if stress.get("expected_post_initial_viewport_requests") != 0:
        raise ValueError(
            "The frozen final RQ2 frame-stress request pattern permits zero post-initial viewport requests."
        )
    expected = [
        ("detail-1k-primitives", "detail", 500, 0, 999),
        ("detail-5k-primitives", "detail", 2500, 0, 4999),
        ("detail-10k-primitives", "detail", 5000, 0, 9999),
        ("detail-20k-primitives", "detail", 10000, 0, 19999),
        ("detail-40k-primitives", "detail", 20000, 0, 39999),
        ("triangle-10k-primitives", "triangle_control", 3333, 3333, 9998),
        ("triangle-20k-primitives", "triangle_control", 6667, 6666, 19999),
    ]
    observed = [
        (
            item.get("id"),
            item.get("family"),
            item.get("node_count"),
            item.get("triangle_count"),
            item.get("expected_primitive_count"),
        )
        for item in experiment.get("fixtures", [])
    ]
    if observed != expected:
        raise ValueError(
            "Final RQ2 fixture matrix differs from the frozen seven-condition matrix."
        )
    for item in experiment["fixtures"]:
        if (
            item["expected_primitive_count"]
            != item["node_count"] + item["node_count"] - 1 + item["triangle_count"]
        ):
            raise ValueError(
                f"Fixture {item['id']} has inconsistent primitive cardinality."
            )


def _validate_run_id(run_id: str) -> None:
    if not (
        FINAL_RUN_ID_PATTERN.fullmatch(run_id)
        or DEVELOPMENT_RUN_ID_PATTERN.fullmatch(run_id)
    ):
        raise ValueError(
            "Run ID must be thesis-final-rq2-v020-NNN or dev-rq2-final-<slug>."
        )


def run(args: argparse.Namespace) -> Path:
    _validate_run_id(args.run_id)
    root = repository_root()
    experiment = load_final_experiment(root / "eval/config/rq2-experiments.json")
    if FINAL_RUN_ID_PATTERN.fullmatch(args.run_id):
        _validate_final_product_isolation(root)
    _validate_browser_prerequisites(root)
    selected = _selected_fixtures(experiment, args.conditions)
    results_root = (args.results_root or root / "eval/results/raw").resolve()
    run_dir = create_isolated_run_directory(results_root, EXPERIMENT_ID, args.run_id)
    expected = len(selected) * (
        experiment["warmup_repetitions"] + experiment["measured_repetitions"]
    )
    manifest = _manifest(
        args.run_id,
        experiment,
        selected,
        expected,
        capture_environment(root),
        "running",
    )
    write_json(run_dir / "resolved-config.json", experiment)
    write_json(run_dir / "manifest.json", manifest)
    observations: list[dict[str, Any]] = []
    for fixture in selected:
        for index in range(6):
            role = "warmup" if index == 0 else "measured"
            observation = _run_observation(
                root, run_dir, args.run_id, experiment, fixture, index, role
            )
            observations.append(observation)
            _append_jsonl(run_dir / "observations.jsonl", observation)
    write_json(run_dir / "summary.json", summarize_final_observations(observations))
    manifest["state"] = "completed"
    manifest["observed_terminal_observations"] = len(observations)
    manifest["observed_browser_versions"] = sorted(
        {row["browser"]["version"] for row in observations if row["browser"]["version"]}
    )
    manifest["observed_playwright_versions"] = sorted(
        {
            row["browser"]["playwright_version"]
            for row in observations
            if row["browser"]["playwright_version"]
        }
    )
    manifest["fixture_sha256"] = {
        row["condition"]["id"]: row["fixture"]["sha256"] for row in observations
    }
    manifest["gpu_preflight_passed"] = all(
        row["gpu"]["hardware_accelerated"] for row in observations
    )
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def _selected_fixtures(experiment: dict, requested: list[str] | None) -> list[dict]:
    if not requested:
        return list(experiment["fixtures"])
    known = {item["id"]: item for item in experiment["fixtures"]}
    unknown = sorted(set(requested) - set(known))
    if unknown:
        raise ValueError(f"Unknown final RQ2 condition(s): {', '.join(unknown)}")
    return [item for item in experiment["fixtures"] if item["id"] in requested]


def _validate_browser_prerequisites(root: Path) -> None:
    for path in (
        root / "code/client/dist/index.js",
        root / "eval/browser/dist/index.html",
        root / "eval/browser/src/final_runner.mjs",
    ):
        if not path.is_file():
            raise ValueError(f"Built browser prerequisite is missing: {path}")


def _validate_final_product_isolation(root: Path) -> None:
    commands = (
        (
            ["git", "diff", "--quiet", "--", "code/server", "code/client"],
            "Product source has uncommitted changes.",
        ),
        (
            [
                "git",
                "diff",
                "--quiet",
                PRODUCT_RELEASE_COMMIT,
                "--",
                "code/server",
                "code/client",
            ],
            "Product source differs from the frozen v0.2.0 release commit.",
        ),
        (
            ["git", "diff", "--cached", "--quiet", "--", "code/server", "code/client"],
            "Product source has staged changes.",
        ),
    )
    for command, error in commands:
        completed = subprocess.run(command, cwd=root, check=False)
        if completed.returncode != 0:
            raise ValueError(error)


def _run_observation(
    root: Path,
    run_dir: Path,
    run_id: str,
    experiment: dict,
    fixture: dict,
    index: int,
    role: str,
) -> dict:
    observation_id = f"{role}-{index:03d}"
    directory = run_dir / "observations" / fixture["id"] / observation_id
    paths = {
        name: directory / filename
        for name, filename in {
            "request": "request.json",
            "runtime_state": "runtime-state.json",
            "result": "browser-result.json",
            "frame_samples": "frame-samples.json",
            "replay_log": "replay-access-log.json",
            "stdout": "stdout.jsonl",
            "stderr": "stderr.log",
            "screenshot": "screenshot.png",
        }.items()
    }
    control = {
        "run_id": run_id,
        "fixture": fixture,
        "browser": experiment["browser"],
        "global_prepared_node_count": experiment["global_prepared_node_count"],
        "max_nodes": experiment["max_nodes"],
        "quiescence_ms": experiment["quiescence_ms"],
        "frame_stress": experiment["frame_stress"],
        "browser_dist_path": str(root / "eval/browser/dist"),
        "runtime_state_path": str(paths["runtime_state"]),
        "frame_samples_path": str(paths["frame_samples"]),
        "replay_access_log_path": str(paths["replay_log"]),
        "screenshot_path": str(paths["screenshot"]),
    }
    write_json(paths["request"], control)
    result, monitor = _run_node_and_monitor(
        [
            "node",
            str(root / "eval/browser/src/final_runner.mjs"),
            str(paths["request"]),
            str(paths["result"]),
        ],
        root,
        paths,
        float(experiment["timeout_seconds"]),
    )
    observation = _observation_from_result(
        run_id, experiment, fixture, observation_id, index, role, result, monitor, paths
    )
    validate_rq2_final_observation(observation)
    write_json(directory / "observation.json", observation)
    return observation


def _run_node_and_monitor(
    command: list[str], root: Path, paths: dict[str, Path], timeout: float
) -> tuple[dict | None, dict]:
    monitor: dict[str, Any] = {
        "scope": "unavailable",
        "baseline": None,
        "post_t2": None,
        "peak": None,
        "root_peak": None,
        "timed_out": False,
    }
    runtime: dict | None = None
    with (
        paths["stdout"].open("w", encoding="utf-8") as stdout,
        paths["stderr"].open("w", encoding="utf-8") as stderr,
    ):
        process = subprocess.Popen(
            command, cwd=root, stdout=stdout, stderr=stderr, start_new_session=True
        )
        deadline = time.monotonic() + timeout
        runtime_deadline = time.monotonic() + min(timeout, 10.0)
        browser: psutil.Process | None = None
        while process.poll() is None:
            if runtime is None and paths["runtime_state"].is_file():
                try:
                    runtime = json.loads(
                        paths["runtime_state"].read_text(encoding="utf-8")
                    )
                    browser = psutil.Process(int(runtime["browser_pid"]))
                except (
                    OSError,
                    ValueError,
                    KeyError,
                    json.JSONDecodeError,
                    psutil.Error,
                ):
                    runtime = None
            elif runtime is not None:
                try:
                    runtime = json.loads(
                        paths["runtime_state"].read_text(encoding="utf-8")
                    )
                except (OSError, json.JSONDecodeError):
                    pass
            if browser is not None and runtime is not None:
                value, scope, root_value = _sample_browser_tree(browser)
                monitor["scope"] = scope
                monitor["root_peak"] = max(
                    filter(
                        lambda item: item is not None,
                        [monitor["root_peak"], root_value],
                    ),
                    default=root_value,
                )
                if scope == "process_tree" and value is not None:
                    monitor["peak"] = max(
                        filter(lambda item: item is not None, [monitor["peak"], value]),
                        default=value,
                    )
                    if (
                        runtime.get("phase") == "baseline"
                        and monitor["baseline"] is None
                    ):
                        monitor["baseline"] = value
                    if runtime.get("phase") == "post_t2" and monitor["post_t2"] is None:
                        monitor["post_t2"] = value
            if runtime is None and time.monotonic() >= runtime_deadline:
                _terminate_process_group(process)
                monitor["runtime_state_timeout"] = True
                break
            if time.monotonic() >= deadline:
                _terminate_process_group(process)
                monitor["timed_out"] = True
                break
            time.sleep(RSS_INTERVAL_SECONDS)
        process.wait()
        monitor["exit_status"] = process.returncode
    return _read_result(paths["stdout"], paths["result"]), monitor


def _sample_browser_tree(browser: psutil.Process) -> tuple[int | None, str, int | None]:
    try:
        root_value = browser.memory_info().rss
        related = [browser, *browser.children(recursive=True)]
        live = [
            item
            for item in related
            if item.is_running() and item.status() != psutil.STATUS_ZOMBIE
        ]
        return sum(item.memory_info().rss for item in live), "process_tree", root_value
    except (psutil.Error, PermissionError, ValueError):
        try:
            return None, "root_only", browser.memory_info().rss
        except (psutil.Error, PermissionError):
            return None, "unavailable", None


def _terminate_process_group(process: subprocess.Popen) -> None:
    if os.name != "nt":
        os.killpg(process.pid, signal.SIGKILL)
    else:  # pragma: no cover
        process.kill()


def _read_result(stdout: Path, result: Path) -> dict | None:
    try:
        lines = [
            line
            for line in stdout.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        payload = json.loads(lines[0]) if len(lines) == 1 else None
        if (
            payload is None
            or not result.is_file()
            or json.loads(result.read_text(encoding="utf-8")) != payload
        ):
            return None
        return payload
    except (OSError, json.JSONDecodeError):
        return None


def _observation_from_result(
    run_id: str,
    experiment: dict,
    fixture: dict,
    observation_id: str,
    index: int,
    role: str,
    result: dict | None,
    monitor: dict,
    paths: dict[str, Path],
) -> dict:
    result = result or {}
    status = "timeout" if monitor.get("timed_out") else result.get("status", "failure")
    if status not in {"success", "failure", "timeout", "invalid"}:
        status = "failure"
    failure_kind = result.get("failure_kind", "harness_protocol_failure")
    if failure_kind not in FAILURE_KINDS:
        failure_kind = "harness_protocol_failure"
    fixture_result = result.get("fixture", {})
    browser_result = result.get("browser", {})
    gpu = result.get("gpu", {})
    snapshot = result.get("snapshot", {})
    replay = result.get("replay", {})
    if status == "success" and (
        not gpu.get("hardware_accelerated")
        or not snapshot.get("fixture_congruent")
        or replay.get("truncated") is not False
    ):
        status, failure_kind = "invalid", "snapshot_fixture_mismatch"
    rss_available = (
        monitor.get("scope") == "process_tree" and monitor.get("peak") is not None
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "experiment_id": EXPERIMENT_ID,
        "observation_id": observation_id,
        "role": role,
        "repetition_index": index,
        "status": status,
        "failure_kind": "none" if status == "success" else failure_kind,
        "condition": {
            "id": fixture["id"],
            "family": fixture["family"],
            "global_prepared_node_count": experiment["global_prepared_node_count"],
            "max_nodes": experiment["max_nodes"],
            "timeout_seconds": experiment["timeout_seconds"],
        },
        "fixture": {
            "id": fixture_result.get("id", fixture["id"]),
            "sha256": fixture_result.get("sha256", "0" * 64),
            "response_sha256": fixture_result.get("response_sha256", "0" * 64),
            "node_count": fixture_result.get("node_count", fixture["node_count"]),
            "edge_count": fixture_result.get("edge_count", fixture["node_count"] - 1),
            "triangle_count": fixture_result.get(
                "triangle_count", fixture["triangle_count"]
            ),
            "expected_primitive_count": fixture_result.get(
                "expected_primitive_count", fixture["expected_primitive_count"]
            ),
            "labels_enabled": fixture.get("labels_enabled", False),
            "mutated": bool(fixture_result.get("mutated", False)),
        },
        "browser": {
            "version": browser_result.get("version"),
            "executable_path": browser_result.get("executable_path"),
            "playwright_version": browser_result.get("playwright_version"),
            "headless": False,
            "viewport": experiment["browser"]["viewport"],
            "device_scale_factor": 1,
            "locale": "en-US",
            "timezone": "UTC",
            "fresh_process": True,
        },
        "gpu": {
            "hardware_accelerated": bool(gpu.get("hardware_accelerated")),
            "webgl_vendor": gpu.get("webgl_vendor"),
            "webgl_renderer": gpu.get("webgl_renderer"),
            "backend": gpu.get("backend"),
            "evidence": gpu.get("evidence"),
        },
        "timing": {
            key: result.get("timing", {}).get(key)
            for key in (
                "t0_ms",
                "t1_ms",
                "t2_ms",
                "client_first_visualization_ms",
                "load_resolve_ms",
                "post_load_frame_ms",
            )
        },
        "heap": result.get("heap", {}),
        "rss": {
            "state": "available" if rss_available else "unavailable",
            "scope": "process_tree"
            if rss_available
            else monitor.get("scope", "unavailable"),
            "sampling_interval_seconds": RSS_INTERVAL_SECONDS,
            "baseline_rss_bytes": monitor.get("baseline") if rss_available else None,
            "post_t2_rss_bytes": monitor.get("post_t2") if rss_available else None,
            "peak_rss_bytes": monitor.get("peak") if rss_available else None,
            "diagnostic_root_rss_bytes": monitor.get("root_peak"),
        },
        "snapshot": {
            "sequence": snapshot.get("sequence"),
            "reason": snapshot.get("reason"),
            "node_count": snapshot.get("node_count"),
            "edge_count": snapshot.get("edge_count"),
            "primitive_count": snapshot.get("primitive_count"),
            "triangle_count": snapshot.get("triangle_count"),
            "fixture_congruent": bool(snapshot.get("fixture_congruent")),
        },
        "replay": {
            "request_count": replay.get("request_count", 0),
            "viewport_request_count": replay.get("viewport_request_count", 0),
            "post_initial_viewport_request_count": replay.get(
                "post_initial_viewport_request_count", 0
            ),
            "request_pattern_valid": bool(replay.get("request_pattern_valid")),
            "truncated": bool(replay.get("truncated", True)),
            "response_cardinality_valid": bool(
                replay.get("response_cardinality_valid")
            ),
            "response_checksums": replay.get("response_checksums", []),
        },
        "frame_statistics": frame_statistics(result.get("frame_intervals_ms", [])),
        "artifacts": {name: str(path) for name, path in paths.items()},
        "error": None
        if status == "success"
        else result.get("message", "No valid terminal result produced."),
    }


def frame_statistics(values: list[float]) -> dict[str, Any]:
    valid = sorted(
        float(value)
        for value in values
        if isinstance(value, (int, float)) and value >= 0
    )
    if not valid:
        return {
            "sample_count": 0,
            "median_ms": None,
            "p95_ms": None,
            "maximum_ms": None,
            "above_50_ms_count": 0,
        }
    return {
        "sample_count": len(valid),
        "median_ms": percentile(valid, 0.5),
        "p95_ms": percentile(valid, 0.95),
        "maximum_ms": valid[-1],
        "above_50_ms_count": sum(value > 50 for value in valid),
    }


def summarize_final_observations(observations: list[dict]) -> dict:
    measured = [row for row in observations if row["role"] == "measured"]
    groups: dict[str, list[dict]] = {}
    for row in measured:
        groups.setdefault(row["condition"]["id"], []).append(row)
    return {
        "schema_version": SCHEMA_VERSION,
        "groups": [_summarize_group(groups[key]) for key in sorted(groups)],
    }


def _summarize_group(rows: list[dict]) -> dict:
    success = [row for row in rows if row["status"] == "success"]
    metrics = {
        "client_first_visualization_ms": ("timing", "client_first_visualization_ms"),
        "load_resolve_ms": ("timing", "load_resolve_ms"),
        "post_load_frame_ms": ("timing", "post_load_frame_ms"),
        "js_heap_used_delta_bytes": ("heap", "delta", "js_heap_used_bytes", "bytes"),
        "frame_interval_median_ms": ("frame_statistics", "median_ms"),
        "frame_interval_p95_ms": ("frame_statistics", "p95_ms"),
        "frame_interval_maximum_ms": ("frame_statistics", "maximum_ms"),
        "frame_interval_above_50_ms_count": ("frame_statistics", "above_50_ms_count"),
    }
    if success and all(row["rss"]["state"] == "available" for row in success):
        metrics["process_tree_peak_rss_bytes"] = ("rss", "peak_rss_bytes")
    return {
        "condition": rows[0]["condition"],
        "fixture": rows[0]["fixture"],
        "configured_count": len(rows),
        "success_count": len(success),
        "failure_count": sum(row["status"] == "failure" for row in rows),
        "timeout_count": sum(row["status"] == "timeout" for row in rows),
        "invalid_count": sum(row["status"] == "invalid" for row in rows),
        "metrics": {
            name: summary(
                [value for row in success if (value := _get(row, path)) is not None]
            )
            for name, path in metrics.items()
        },
    }


def _get(payload: dict, path: tuple[str, ...]) -> Any:
    value: Any = payload
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value if isinstance(value, (int, float)) else None


def _manifest(
    run_id: str,
    experiment: dict,
    fixtures: list[dict],
    expected: int,
    environment: dict,
    state: str,
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": EXPERIMENT_ID,
        "run_id": run_id,
        "state": state,
        "created_utc": utc_now(),
        "expected_terminal_observations": expected,
        "observed_terminal_observations": 0,
        "policy": {
            "warmup_repetitions": 1,
            "measured_repetitions": 5,
            "retries": 0,
            "timeout_seconds": 45,
            "fresh_headed_chromium_per_observation": True,
            "browser_startup_outside_primary_timing": True,
            "global_prepared_node_count": experiment["global_prepared_node_count"],
            "max_nodes": 100000,
            "small_dataset_path_excluded": True,
        },
        "browser": experiment["browser"],
        "fixtures": fixtures,
        "environment": environment,
        "product": {
            "version": PRODUCT_RELEASE_VERSION,
            "release_commit": PRODUCT_RELEASE_COMMIT,
            "source_diff_empty": True,
        },
        "observed_browser_versions": [],
        "observed_playwright_versions": [],
        "fixture_sha256": {},
        "gpu_preflight_passed": False,
        "scientific_scope": experiment["scientific_scope"],
    }


def _append_jsonl(path: Path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
