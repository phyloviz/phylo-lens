"""RQ4 real-server, public-bootstrap warm-session evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .common import (
    create_isolated_run_directory,
    new_run_id,
    utc_now,
    validate_manifest,
    validate_rq4_observation,
    write_json,
)
from .environment import capture_environment
from .rq2 import frame_statistics
from .stats import summary

POLICY = "fresh_process_public_bootstrap_warm_session"
OPERATIONS = {"viewport_navigation", "cluster_expand", "cluster_collapse"}
FAILURE_KINDS = {
    "none",
    "invalid_configuration",
    "prepared_layout_unavailable",
    "server_start_failure",
    "server_readiness_timeout",
    "browser_launch_failure",
    "bootstrap_failure",
    "no_eligible_target",
    "operation_input_failure",
    "expected_request_not_observed",
    "unexpected_request",
    "external_network_request",
    "api_error",
    "operation_timeout",
    "snapshot_application_timeout",
    "expected_observer_event_not_observed",
    "structural_state_unchanged",
    "unexpected_structural_state",
    "browser_crash",
    "harness_protocol_failure",
}


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_experiment(path: Path, experiment_id: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = [
        row for row in payload.get("experiments", []) if row.get("id") == experiment_id
    ]
    if payload.get("schema_version") != "1" or len(rows) != 1:
        raise ValueError("Invalid or unknown RQ4 experiment configuration.")
    row = rows[0]
    if (
        row.get("research_question") != "RQ4"
        or row.get("server_state_policy") != POLICY
        or not row.get("scenarios")
    ):
        raise ValueError("RQ4 requires public-bootstrap warm-session scenarios.")
    if any(item.get("operation") not in OPERATIONS for item in row["scenarios"]):
        raise ValueError("RQ4 has an unsupported operation.")
    if row.get("synthetic_dataset", {}).get("node_count", 0) <= 6000:
        raise ValueError(
            "RQ4 pilot must exercise production LoD with more than 6000 nodes."
        )
    return row


def deterministic_newick(count: int) -> str:
    if not isinstance(count, int) or count <= 6000:
        raise ValueError(
            "RQ4 pilot needs more than 6000 nodes to exercise production LoD."
        )
    level = [f"n{index}:0.01" for index in range(count)]
    depth = 0
    while len(level) > 1:
        next_level = []
        for index in range(0, len(level), 2):
            if index + 1 == len(level):
                next_level.append(level[index])
            else:
                next_level.append(
                    f"({level[index]},{level[index + 1]})cluster-{depth}-{index // 2}:{0.01 * (depth + 1):.2f}"
                )
        level = next_level
        depth += 1
    return f"{level[0].removesuffix(':0.01')};"


def select_aggregate_target(
    targets: list[dict], requested_id: str | None
) -> dict | None:
    """Apply the declared exact-id or stable-sort aggregate selection rule."""
    if requested_id is not None:
        return next(
            (item for item in targets if item.get("clusterId") == requested_id), None
        )
    eligible = [item for item in targets if isinstance(item.get("clusterId"), str)]
    return min(eligible, key=lambda item: item["clusterId"], default=None)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_ready(port: int, process: subprocess.Popen, timeout: float) -> None:
    import urllib.request

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("server_start_failure")
        try:
            response = urllib.request.urlopen(
                f"http://127.0.0.1:{port}/health", timeout=1
            )
            if json.loads(response.read())["status"] == "ok":
                return
        except Exception:
            time.sleep(0.05)
    raise RuntimeError("server_readiness_timeout")


def run(args: argparse.Namespace) -> Path:
    root = repository_root()
    exp = load_experiment(root / "eval/config/rq4-experiments.json", args.experiment)
    warmups = exp["warmup_repetitions"] if args.warmups is None else args.warmups
    repetitions = (
        exp["measured_repetitions"] if args.repetitions is None else args.repetitions
    )
    if warmups < 0 or repetitions < 1:
        raise ValueError("RQ4 repetition counts must be non-negative and non-zero.")
    run_dir = create_isolated_run_directory(
        (args.results_root or root / "eval/results/raw").resolve(),
        exp["id"],
        new_run_id(),
    )
    content = deterministic_newick(exp["synthetic_dataset"]["node_count"])
    checksum = hashlib.sha256(content.encode()).hexdigest()
    resolved = {
        **exp,
        "warmup_repetitions": warmups,
        "measured_repetitions": repetitions,
    }
    environment = capture_environment(root)
    write_json(run_dir / "resolved-config.json", resolved)
    manifest = _manifest(exp, run_dir.name, resolved, environment, checksum, "running")
    validate_manifest(manifest)
    write_json(run_dir / "manifest.json", manifest)

    rows: list[dict] = []
    for index in range(warmups + repetitions):
        for scenario in exp["scenarios"]:
            rows.append(
                _repetition(
                    root,
                    run_dir,
                    exp,
                    scenario,
                    content,
                    checksum,
                    index,
                    index < warmups,
                )
            )
    _invalidate_non_equivalent_layouts(rows)
    for row in rows:
        validate_rq4_observation(row)
    (run_dir / "observations.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    write_json(run_dir / "summary.json", summarize(rows))
    manifest = _manifest(
        exp, run_dir.name, resolved, environment, checksum, "completed"
    )
    validate_manifest(manifest)
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def _repetition(
    root: Path,
    run_dir: Path,
    exp: dict,
    scenario: dict,
    content: str,
    checksum: str,
    index: int,
    warmup: bool,
) -> dict:
    label = f"{'warmup' if warmup else 'measured'}-{index + 1:03d}"
    directory = run_dir / "repetitions" / scenario["id"] / label
    directory.mkdir(parents=True)
    port, web_port = free_port(), free_port()
    api = f"http://127.0.0.1:{port}"
    env = {
        **os.environ,
        "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(directory / "prepared-layout"),
        "PHYLO_LENS_CORS_ORIGINS": f"http://127.0.0.1:{web_port}",
    }
    result: dict = {"status": "failure", "failure_kind": "server_start_failure"}
    server: subprocess.Popen | None = None
    with (
        (directory / "server.stdout.log").open("w") as out,
        (directory / "server.stderr.log").open("w") as err,
    ):
        try:
            server = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "phylo_lens_server.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                cwd=root,
                env=env,
                stdout=out,
                stderr=err,
            )
            wait_ready(port, server, exp["timeout_seconds"])
            control = {
                "api_url": api,
                "web_port": web_port,
                "browser_dist_path": str(root / "eval/browser/dist"),
                "browser": exp["browser"],
                "content": content,
                "name": exp["synthetic_dataset"]["id"],
                "maxNodes": 100,
                "operation": scenario["operation"],
                "input": scenario.get("input", {}),
                "target_cluster_id": scenario.get("target_cluster_id"),
                "screenshot_path": str(directory / "post-t4.png"),
                "setup_quiescence_ms": scenario.get(
                    "setup_quiescence_ms", exp["setup_quiescence_ms"]
                ),
                "timeout_ms": int(exp["timeout_seconds"] * 1000),
            }
            write_json(directory / "request.json", control)
            result_path = directory / "browser-result.json"
            completed = subprocess.run(
                [
                    "node",
                    str(root / "eval/browser/src/rq4-runner.mjs"),
                    str(directory / "request.json"),
                    str(result_path),
                ],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=exp["timeout_seconds"] + 20,
            )
            (directory / "browser.stdout.jsonl").write_text(
                completed.stdout, encoding="utf-8"
            )
            (directory / "browser.stderr.log").write_text(
                completed.stderr, encoding="utf-8"
            )
            result = json.loads(completed.stdout.strip().splitlines()[-1])
        except subprocess.TimeoutExpired as error:
            result = {
                "status": "timeout",
                "failure_kind": "operation_timeout",
                "error": str(error),
            }
        except Exception as error:
            result = {
                "status": "failure",
                "failure_kind": str(error),
                "error": str(error),
            }
        finally:
            if server is not None and server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
    return observation(exp, scenario, checksum, index, warmup, result, directory, api)


def _finite(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _boundary(event: dict) -> dict:
    return event.get("boundary", {}) if isinstance(event, dict) else {}


def _fingerprint(event: dict) -> str | None:
    diagnostics = event.get("diagnostics", {}) if isinstance(event, dict) else {}
    return (
        diagnostics.get("snapshotFingerprint")
        if isinstance(diagnostics, dict)
        else None
    )


def validation_failure(operation: str, result: dict, api_origin: str) -> str | None:
    if result.get("status") != "success":
        return None
    if result.get("clock_domain") != "browser_performance_now":
        return "harness_protocol_failure"
    initial, event = result.get("initial", {}), result.get("event", {})
    expected_reason = (
        "viewport_sync" if operation == "viewport_navigation" else operation
    )
    if _boundary(event).get("reason") != expected_reason:
        return "expected_observer_event_not_observed"
    target = result.get("target") or {}
    if operation != "viewport_navigation" and _boundary(event).get(
        "clusterId"
    ) != target.get("clusterId"):
        return "unexpected_structural_state"
    timestamps = [result.get(key) for key in ("t0", "t3", "t4")]
    if not all(_finite(value) for value in timestamps):
        return "harness_protocol_failure"
    if operation == "cluster_collapse":
        if not timestamps[0] <= timestamps[1] <= timestamps[2]:
            return "harness_protocol_failure"
        relevant_viewport_requests = [
            request
            for request in result.get("operation_request_trace", [])
            if _is_relevant_viewport_request(request, api_origin, None)
        ]
        if relevant_viewport_requests:
            return "unexpected_request"
        expanded = result.get("expanded", {})
        initial_target = _aggregate_descriptor(initial, target.get("clusterId"))
        restored_target = _aggregate_descriptor(event, target.get("clusterId"))
        if (
            _fingerprint(event) == _fingerprint(expanded)
            or initial_target is None
            or restored_target is None
            or initial_target.get("structuralFingerprint")
            != restored_target.get("structuralFingerprint")
        ):
            return "unexpected_structural_state"
        return None
    relevant = result.get("relevant_requests", [])
    if len(relevant) != 1:
        return "expected_request_not_observed" if not relevant else "unexpected_request"
    request = relevant[0]
    expected_cluster = (
        target.get("clusterId") if operation == "cluster_expand" else None
    )
    if not _is_relevant_viewport_request(request, api_origin, expected_cluster):
        return "expected_request_not_observed"
    if request.get("clock") != "browser_performance_now":
        return "harness_protocol_failure"
    if not 200 <= request.get("status", 0) < 300:
        return "api_error"
    t1, t2 = request.get("dispatchTimestamp"), request.get("responseTimestamp")
    if not all(
        _finite(value)
        for value in (timestamps[0], t1, t2, timestamps[1], timestamps[2])
    ):
        return "harness_protocol_failure"
    if not timestamps[0] <= t1 <= t2 <= timestamps[1] <= timestamps[2]:
        return "harness_protocol_failure"
    if _fingerprint(event) == _fingerprint(initial):
        return "structural_state_unchanged"
    allowed_origins = {api_origin, result.get("web_origin")}
    for request in result.get("operation_network_requests", []):
        if (
            urlparse(request.get("url", "")).scheme
            and _origin(request["url"]) not in allowed_origins
        ):
            return "external_network_request"
    return None


def _is_relevant_viewport_request(
    request: dict, api_origin: str, cluster_id: str | None
) -> bool:
    url = request.get("url", "")
    parsed = urlparse(url)
    if _origin(url) != api_origin or parsed.path != "/api/graph/viewport":
        return False
    if cluster_id is None:
        return True
    body = request.get("body")
    return isinstance(body, dict) and body.get("cluster_id") == cluster_id


def _origin(value: str) -> str:
    parsed = urlparse(value)
    return f"{parsed.scheme}://{parsed.netloc}"


def _aggregate_descriptor(event: dict, cluster_id: str | None) -> dict | None:
    diagnostics = event.get("diagnostics", {}) if isinstance(event, dict) else {}
    targets = (
        diagnostics.get("aggregateTargets", []) if isinstance(diagnostics, dict) else []
    )
    return next((item for item in targets if item.get("clusterId") == cluster_id), None)


def observation(
    exp: dict,
    scenario: dict,
    checksum: str,
    index: int,
    warmup: bool,
    result: dict,
    directory: Path,
    api: str,
) -> dict:
    operation = scenario["operation"]
    failure = validation_failure(operation, result, api)
    status = result.get("status", "failure")
    failure_kind = failure or result.get(
        "failure_kind", "none" if status == "success" else "harness_protocol_failure"
    )
    if failure:
        status = "invalid"
    if failure_kind not in FAILURE_KINDS:
        failure_kind = "harness_protocol_failure"
    if status not in {"success", "invalid", "timeout", "failure"}:
        status, failure_kind = "failure", "harness_protocol_failure"

    initial, event = result.get("initial", {}), result.get("event", {})
    relevant = result.get("relevant_requests", [])
    first, last = (relevant[0], relevant[-1]) if relevant else ({}, {})
    t0, t3, t4 = (result.get(key) for key in ("t0", "t3", "t4"))
    t1, t2 = first.get("dispatchTimestamp"), last.get("responseTimestamp")
    local = operation == "cluster_collapse"
    timing = {
        "t0_ms": t0,
        "t1_ms": None if local else t1,
        "t2_ms": None if local else t2,
        "t3_ms": t3,
        "t4_ms": t4,
        "input_to_request_ms": _metric(t1, t0, not local),
        "api_round_trip_ms": _metric(t2, t1, not local),
        "response_to_snapshot_applied_ms": _metric(t3, t2, not local),
        "input_to_snapshot_applied_ms": _metric(t3, t0),
        "snapshot_applied_to_frame_ms": _metric(t4, t3),
        "end_to_end_latency_ms": _metric(t4, t0),
    }
    frames = result.get("frame_intervals_ms", [])
    frame = frame_statistics(frames, exp.get("frame_budget_ms", 16.7))
    frame["frame_budget_ms"] = exp.get("frame_budget_ms", 16.7)
    frame["minimum_sample_count"] = exp.get("minimum_frame_sample_count", 1)
    frame["distribution_state"] = (
        "available"
        if frame["sample_count"] >= frame["minimum_sample_count"]
        else "insufficient"
    )
    if frame["distribution_state"] == "insufficient":
        for key in ("median_ms", "p25_ms", "p75_ms", "iqr_ms", "p95_ms"):
            frame[key] = None
    return {
        "schema_version": "1",
        "experiment_id": exp["id"],
        "run_id": directory.parents[2].name,
        "observation_id": f"{scenario['id']}-{index + 1:03d}",
        "scenario_id": scenario["id"],
        "operation": operation,
        "repetition_index": index,
        "warmup": warmup,
        "status": status,
        "failure_kind": failure_kind,
        "clock_domain": result.get("clock_domain"),
        "server_state_policy": POLICY,
        "dataset_checksum_sha256": checksum,
        "prepared_layout_id": _boundary(initial).get("layoutVersion"),
        "browser": result.get("browser", {"version": None, **exp.get("browser", {})}),
        "initial_state": initial,
        "target": result.get("target"),
        "viewport_state": result.get("viewport_state"),
        "observer": {
            "before": initial,
            "after": event,
            "expanded": result.get("expanded"),
        },
        "observer_events": result.get("observer_events", []),
        "request_trace": result.get("request_trace", []),
        "operation_request_trace": result.get("operation_request_trace", []),
        "operation_network_requests": result.get("operation_network_requests", []),
        "timing": timing,
        "primitive_counts": {
            "before": _primitive_counts(initial),
            "after": _primitive_counts(event),
        },
        "frame_intervals_ms": frames,
        "frame_statistics": frame,
        "artifacts": {
            "directory": str(directory),
            "request": str(directory / "request.json"),
            "browser_result": str(directory / "browser-result.json"),
            "server_stdout": str(directory / "server.stdout.log"),
            "server_stderr": str(directory / "server.stderr.log"),
            "browser_stdout": str(directory / "browser.stdout.jsonl"),
            "browser_stderr": str(directory / "browser.stderr.log"),
            "screenshot": str(directory / "post-t4.png"),
        },
        "error": result.get("error"),
    }


def _metric(after: object, before: object, applicable: bool = True) -> dict:
    if not applicable:
        return {"state": "not_applicable", "value_ms": None}
    value = float(after - before) if _finite(after) and _finite(before) else None
    return {
        "state": "available" if value is not None and value >= 0 else "unavailable",
        "value_ms": value if value is not None and value >= 0 else None,
    }


def _primitive_counts(event: dict) -> dict:
    boundary = _boundary(event)
    diagnostics = event.get("diagnostics", {}) if isinstance(event, dict) else {}
    return {
        "visible_node_count": boundary.get("visibleNodeCount"),
        "visible_edge_count": boundary.get("visibleEdgeCount"),
        "visible_primitive_count": boundary.get("visiblePrimitiveCount"),
        "visible_aggregate_triangle_count": diagnostics.get(
            "visibleAggregateTriangleCount"
        )
        if isinstance(diagnostics, dict)
        else None,
    }


def _invalidate_non_equivalent_layouts(rows: list[dict]) -> None:
    identities = {
        row["prepared_layout_id"]
        for row in rows
        if row["prepared_layout_id"] is not None
    }
    if len(identities) <= 1:
        return
    for row in rows:
        if row["status"] == "success":
            row["status"] = "invalid"
            row["failure_kind"] = "prepared_layout_unavailable"
            row["error"] = (
                "Fresh public bootstraps produced non-equivalent prepared layout identities."
            )


def summarize(rows: list[dict]) -> dict:
    measured = [row for row in rows if not row["warmup"]]
    groups: dict[str, list[dict]] = {}
    for row in measured:
        key = json.dumps(
            {
                "operation": row["operation"],
                "scenario": row["scenario_id"],
                "dataset_checksum_sha256": row["dataset_checksum_sha256"],
                "layout": row["prepared_layout_id"],
                "browser": row["browser"],
                "server_state_policy": row["server_state_policy"],
                "target_cluster_id": (row["target"] or {}).get("clusterId"),
                "target_class": (
                    "interactive_aggregate" if row["target"] is not None else None
                ),
                "target_member_count": (row["target"] or {}).get(
                    "representedNodeCount"
                ),
            },
            sort_keys=True,
        )
        groups.setdefault(key, []).append(row)
    return {
        "schema_version": "1",
        "groups": [
            {
                "conditions": json.loads(key),
                "configured_count": len(items),
                "valid_count": sum(item["status"] == "success" for item in items),
                "invalid_count": sum(item["status"] == "invalid" for item in items),
                "failure_count": sum(item["status"] == "failure" for item in items),
                "timeout_count": sum(item["status"] == "timeout" for item in items),
                "latency_ms": {
                    metric: summary(
                        [
                            item["timing"][metric]["value_ms"]
                            for item in items
                            if item["status"] == "success"
                            and item["timing"][metric]["state"] == "available"
                        ]
                    )
                    for metric in (
                        "input_to_request_ms",
                        "api_round_trip_ms",
                        "response_to_snapshot_applied_ms",
                        "input_to_snapshot_applied_ms",
                        "snapshot_applied_to_frame_ms",
                        "end_to_end_latency_ms",
                    )
                },
                "per_run_frame_statistics": [
                    item["frame_statistics"] for item in items
                ],
            }
            for key, items in groups.items()
        ],
    }


def _manifest(
    exp: dict, run_id: str, resolved: dict, environment: dict, checksum: str, state: str
) -> dict:
    return {
        "schema_version": "1",
        "experiment_id": exp["id"],
        "run_id": run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": {
            key: value for key, value in environment.items() if key != "git"
        },
        "dataset": {
            "id": exp["synthetic_dataset"]["id"],
            "path": "generated:deterministic_newick",
            "checksum_sha256": checksum,
            "format": "newick",
            "topology": "balanced",
            "declared_node_count": exp["synthetic_dataset"]["node_count"],
            "declared_edge_count": exp["synthetic_dataset"]["node_count"],
        },
        "parameters": {
            "experiment_id": exp["id"],
            "dataset_ids": [exp["synthetic_dataset"]["id"]],
            "warmup_repetitions": resolved["warmup_repetitions"],
            "measured_repetitions": resolved["measured_repetitions"],
            "timeout_seconds": resolved["timeout_seconds"],
            "persistence_backend": "sqlite",
        },
        "state": state,
        "rq4": {
            "server_state_policy": POLICY,
            "browser": exp["browser"],
            "setup_quiescence_ms": exp["setup_quiescence_ms"],
            "frame_budget_ms": exp["frame_budget_ms"],
            "minimum_frame_sample_count": exp["minimum_frame_sample_count"],
            "scenario_ordering": "fixed independent scenario groups",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--results-root", type=Path)
    print(run(parser.parse_args()))


if __name__ == "__main__":
    main()
