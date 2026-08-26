"""Final RQ4 browser-observed interaction harness (evaluation-only)."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any

from .common import (
    checksum_sha256,
    create_isolated_run_directory,
    utc_now,
    validate_rq4_final_observation,
    write_json,
)
from .environment import capture_environment
from .rq2 import frame_statistics
from .rq3_final import (
    inspect_layout,
    load_config as load_rq3_config,
    parse_canonical_source,
)
from .stats import summary

EXPERIMENT_ID = "rq4-interactive-final-v020"
PRODUCT_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"
MASTER_RUN_ID = "thesis-final-rq3-v020-002"
FINAL_RUN_ID_PATTERN = re.compile(r"^thesis-final-rq4-v020-[0-9]{3}$")
DEVELOPMENT_RUN_ID_PATTERN = re.compile(r"^dev-rq4-final-[a-z0-9-]+$")


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def load_config(root: Path | None = None) -> dict[str, Any]:
    config = json.loads(
        ((root or repository_root()) / "eval/config/rq4-final-v020.json").read_text()
    )
    expected_scenarios = [
        "navigation",
        "expand-low",
        "collapse-low",
        "expand-representative",
        "collapse-representative",
        "expand-high",
        "collapse-high",
    ]
    if config.get("id") != EXPERIMENT_ID or config.get("product") != {
        "version": "0.2.0",
        "release_commit": PRODUCT_COMMIT,
    }:
        raise ValueError("Frozen final RQ4 configuration is malformed.")
    if (
        not config.get("layout_source_run", "").endswith(MASTER_RUN_ID)
        or config.get("layout", {}).get("database_sha256")
        != "3a2a837e20fe2d1ccf965becc75c51f937050f57c8a2df19886cdf92a3553681"
    ):
        raise ValueError("RQ4 must use the authoritative sealed RQ3 v002 master.")
    if (
        config.get("warmup_repetitions") != 0
        or config.get("measured_repetitions") != 7
        or config.get("retries") != 0
        or config.get("timeout_seconds") != 60
        or [row.get("id") for row in config.get("scenarios", [])] != expected_scenarios
    ):
        raise ValueError("Frozen final RQ4 matrix/policy differs.")
    return config


def _source_path(root: Path, config: dict[str, Any]) -> Path:
    return (
        root.parent / config["dataset"]["repository_parent_relative_path"]
    ).resolve()


def _master_path(root: Path, config: dict[str, Any]) -> Path:
    return (
        root
        / config["layout_source_run"]
        / "prepared-layout"
        / "prepared_layout.sqlite3"
    )


def _validate_run_id(run_id: str) -> None:
    if not (
        FINAL_RUN_ID_PATTERN.fullmatch(run_id)
        or DEVELOPMENT_RUN_ID_PATTERN.fullmatch(run_id)
    ):
        raise ValueError(
            "Run ID must be thesis-final-rq4-v020-NNN or dev-rq4-final-<slug>."
        )


def _validate_final_product_isolation(root: Path) -> None:
    checks = (
        (
            ["git", "diff", "--quiet", "--", "code/server", "code/client"],
            "Product source has unstaged changes.",
        ),
        (
            ["git", "diff", "--cached", "--quiet", "--", "code/server", "code/client"],
            "Product source has staged changes.",
        ),
        (
            [
                "git",
                "diff",
                "--quiet",
                PRODUCT_COMMIT,
                "--",
                "code/server",
                "code/client",
            ],
            "Product source differs from frozen v0.2.0.",
        ),
    )
    for command, message in checks:
        if subprocess.run(command, cwd=root, check=False).returncode:
            raise ValueError(message)


def _validate_final_worktree_clean(root: Path) -> None:
    completed = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode or completed.stdout:
        raise ValueError("Final RQ4 requires a clean evaluation worktree.")


def _verify_master(
    root: Path, config: dict[str, Any], source: dict[str, Any]
) -> dict[str, Any]:
    database = _master_path(root, config)
    if not database.is_file() or database.stat().st_mode & 0o222:
        raise ValueError(
            "Authoritative RQ3 v002 sealed master is unavailable or writable."
        )
    if any(
        database.with_name(database.name + suffix).exists()
        for suffix in ("-wal", "-shm")
    ):
        raise ValueError("Authoritative RQ3 v002 master has SQLite sidecars.")
    physical_sha = checksum_sha256(database)
    layout = config["layout"]
    if physical_sha != layout["database_sha256"]:
        raise ValueError("Authoritative RQ3 v002 master SHA256 differs.")
    inspected = inspect_layout(database, source, load_rq3_config(root), layout["id"])
    if (
        inspected["prepared_layout_id"] != layout["id"]
        or inspected["table_sha256"] != layout["table_sha256"]
        or inspected["source_position_count"] != config["dataset"]["node_count"]
        or inspected["source_graph_edge_count"] != config["dataset"]["edge_count"]
    ):
        raise ValueError("Authoritative RQ3 v002 semantic layout identity differs.")
    targets = {
        target["cluster_id"]: target
        for scenario in config["scenarios"]
        if (target := scenario.get("target"))
    }
    with sqlite3.connect(f"file:{database}?mode=ro&immutable=1", uri=True) as conn:
        observed_targets = {
            row[0]: {
                "representative_node_id": row[1],
                "represented_member_count": row[2],
            }
            for row in conn.execute(
                "select cluster_id, representative_node_id, member_count "
                "from prepared_clusters where dataset_id=? and layout_version=? "
                f"and cluster_id in ({','.join('?' for _ in targets)})",
                (source["dataset"].dataset_id, layout["id"], *targets),
            )
        }
    if observed_targets != {
        cluster_id: {
            "representative_node_id": target["representative_node_id"],
            "represented_member_count": target["represented_member_count"],
        }
        for cluster_id, target in targets.items()
    }:
        raise ValueError("Frozen RQ4 target IDs/member counts differ from master.")
    return {
        "run_id": MASTER_RUN_ID,
        "path": str(database),
        "physical_sha256": physical_sha,
        "size_bytes": database.stat().st_size,
        "layout_id": inspected["prepared_layout_id"],
        "table_sha256": inspected["table_sha256"],
        "levels": inspected["levels"],
        "bounds": inspected["bounds"],
    }


def _copy_master_for_runtime(master: dict[str, Any], directory: Path) -> dict[str, Any]:
    source, runtime = Path(master["path"]), directory / "runtime-prepared-layout"
    runtime.mkdir(parents=True, exist_ok=False)
    destination = runtime / source.name
    shutil.copy2(source, destination)
    destination.chmod(0o644)
    initial_sha = checksum_sha256(destination)
    if initial_sha != master["physical_sha256"]:
        raise ValueError("Observation runtime copy does not equal the sealed master.")
    return {"path": str(destination), "initial_sha256": initial_sha}


def _wait_ready(port: int, process: subprocess.Popen[str], deadline: float) -> None:
    import urllib.request

    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("server_start_failure")
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/health", timeout=1
            ) as response:
                if json.loads(response.read())["status"] == "ok":
                    return
        except Exception:
            time.sleep(0.05)
    raise RuntimeError("server_readiness_timeout")


def _finite(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _boundary(event: Any) -> dict[str, Any]:
    return event.get("boundary", {}) if isinstance(event, dict) else {}


def _diagnostics(event: Any) -> dict[str, Any]:
    return (
        event.get("diagnostics", {})
        if isinstance(event, dict) and isinstance(event.get("diagnostics"), dict)
        else {}
    )


def _state_counts(event: Any) -> dict[str, Any]:
    boundary, diagnostics = _boundary(event), _diagnostics(event)
    return {
        "materialized_nodes": boundary.get("visibleNodeCount"),
        "materialized_edges": boundary.get("visibleEdgeCount"),
        "visible_primitives": boundary.get("visiblePrimitiveCount"),
        "visible_aggregate_triangles": diagnostics.get("visibleAggregateTriangleCount"),
        "snapshot_fingerprint": diagnostics.get("snapshotFingerprint"),
    }


def _metric(after: Any, before: Any, applicable: bool = True) -> dict[str, Any]:
    if not applicable:
        return {"state": "not_applicable", "value_ms": None}
    value = (
        float(after - before)
        if _finite(after) and _finite(before) and after >= before
        else None
    )
    return {
        "state": "available" if value is not None else "unavailable",
        "value_ms": value,
    }


def validate_result(
    operation: str, target: dict[str, Any] | None, result: dict[str, Any]
) -> str | None:
    if result.get("status") != "success":
        return None
    input_event, after, initial = (
        result.get("input_event"),
        result.get("event"),
        result.get("initial"),
    )
    expected_reason = (
        "viewport_sync" if operation == "viewport_navigation" else operation
    )
    expected_input = "click" if operation == "cluster_expand" else "dblclick"
    if (
        result.get("clock_domain") != "browser_performance_now"
        or not isinstance(input_event, dict)
        or input_event.get("eventType") != expected_input
        or not input_event.get("isTrusted")
        or _boundary(after).get("reason") != expected_reason
    ):
        return "validation_failure"
    if (
        operation != "viewport_navigation"
        and _boundary(after).get("clusterId") != target["cluster_id"]
    ):
        return "validation_failure"
    t0, t_snapshot, t_settled = (
        input_event.get("timestamp"),
        after.get("timestamp"),
        result.get("t_settled"),
    )
    if (
        not all(_finite(item) for item in (t0, t_snapshot, t_settled))
        or not t0 <= t_snapshot <= t_settled
    ):
        return "validation_failure"
    if (
        not result.get("gpu", {}).get("hardware_accelerated")
        or result.get("gpu", {}).get("backend") != "Metal"
        or not result.get("baseline_frame_intervals_ms")
        or not result.get("frame_intervals_ms")
    ):
        return "validation_failure"
    requests = result.get("relevant_requests", [])
    if operation == "cluster_collapse":
        pre_boundary = _boundary(result.get("pre_operation"))
        if (
            requests
            or pre_boundary.get("reason") != "cluster_expand"
            or pre_boundary.get("clusterId") != target["cluster_id"]
            or _diagnostics(after).get("snapshotFingerprint")
            == _diagnostics(result.get("pre_operation")).get("snapshotFingerprint")
        ):
            return "validation_failure"
        return None
    if len(requests) != 1:
        return "validation_failure"
    metadata = result.get("response_metadata", [])
    if (
        len(metadata) != 1
        or metadata[0].get("status") != 200
        or not isinstance(metadata[0].get("truncated"), bool)
    ):
        return "validation_failure"
    request = requests[0]
    t_fetch, t_response = (
        request.get("fetchInvocationTimestamp"),
        request.get("responseTimestamp"),
    )
    if (
        not all(_finite(item) for item in (t_fetch, t_response))
        or not t0 <= t_fetch <= t_response <= t_snapshot <= t_settled
    ):
        return "validation_failure"
    phases = (
        (t_fetch - t0)
        + (t_response - t_fetch)
        + (t_snapshot - t_response)
        + (t_settled - t_snapshot)
    )
    if abs(phases - (t_settled - t0)) > 0.001 or _diagnostics(after).get(
        "snapshotFingerprint"
    ) == _diagnostics(initial).get("snapshotFingerprint"):
        return "validation_failure"
    return None


def _observation(
    config: dict[str, Any],
    run_id: str,
    directory: Path,
    scenario: dict[str, Any],
    index: int,
    master: dict[str, Any],
    runtime: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    operation, target = scenario["operation"], scenario.get("target")
    validation = validate_result(operation, target, result)
    status = "invalid" if validation else result.get("status", "failure")
    failure_kind = validation or result.get(
        "failure_kind", "none" if status == "success" else "browser_failure"
    )
    if status not in {"success", "failure", "timeout", "invalid"}:
        status, failure_kind = "failure", "protocol_failure"
    local, input_event, after = (
        operation == "cluster_collapse",
        result.get("input_event", {}),
        result.get("event", {}),
    )
    request = (result.get("relevant_requests") or [{}])[0]
    t0, snapshot, settled = (
        input_event.get("timestamp"),
        after.get("timestamp"),
        result.get("t_settled"),
    )
    timing = {
        "clock_domain": "browser_performance_now",
        "t0_event_ms": t0,
        "t_fetch_ms": None if local else request.get("fetchInvocationTimestamp"),
        "t_resource_start_ms": None if local else request.get("dispatchTimestamp"),
        "t_response_ms": None if local else request.get("responseTimestamp"),
        "t_snapshot_ms": snapshot,
        "t_settled_ms": settled,
        "settle_latency_ms": _metric(settled, t0),
        "event_to_request_ms": _metric(
            request.get("fetchInvocationTimestamp"), t0, not local
        ),
        "browser_http_ms": _metric(
            request.get("responseTimestamp"),
            request.get("fetchInvocationTimestamp"),
            not local,
        ),
        "response_to_snapshot_ms": _metric(
            snapshot, request.get("responseTimestamp"), not local
        ),
        "event_to_snapshot_ms": _metric(snapshot, t0, local),
        "snapshot_to_settle_ms": _metric(settled, snapshot),
    }
    row = {
        "schema_version": "1",
        "experiment_id": EXPERIMENT_ID,
        "run_id": run_id,
        "observation_id": f"{scenario['id']}-measured-{index:03d}",
        "scenario": scenario["id"],
        "role": "measured",
        "status": status,
        "failure_kind": failure_kind,
        "provenance": {
            "product_commit": PRODUCT_COMMIT,
            "dataset_source_sha256": config["dataset"]["sha256"],
            "authoritative_master": master,
            "runtime_copy": runtime,
            "fresh_process": True,
        },
        "lifecycle": {
            "public_bootstrap_completed": result.get("status") == "success",
            "layout_preparation_outside_timing": True,
            "fresh_api_server": True,
            "fresh_browser": True,
        },
        "browser": result.get("browser", {}),
        "gpu": result.get("gpu", {}),
        "target": target,
        "state": {
            "initial": _state_counts(result.get("initial")),
            "pre_operation": _state_counts(result.get("pre_operation")),
            "post_operation": _state_counts(after),
        },
        "timing": timing,
        "baseline_frames": {
            "intervals_ms": result.get("baseline_frame_intervals_ms", []),
            "statistics": frame_statistics(
                result.get("baseline_frame_intervals_ms", []), 50
            ),
        },
        "operation_frames": {
            "intervals_ms": result.get("frame_intervals_ms", []),
            "statistics": frame_statistics(result.get("frame_intervals_ms", []), 50),
        },
        "requests": {
            "operation": result.get("request_trace", []),
            "relevant": result.get("relevant_requests", []),
            "response_metadata": result.get("response_metadata", []),
            "http_applicable": not local,
        },
        "observer": {
            "initial": result.get("initial"),
            "pre_operation": result.get("pre_operation"),
            "after": after,
        },
        "artifacts": {
            "directory": str(directory),
            "request": str(directory / "request.json"),
            "result": str(directory / "browser-result.json"),
            "server_stdout": str(directory / "server.stdout.log"),
            "server_stderr": str(directory / "server.stderr.log"),
            "browser_stdout": str(directory / "browser.stdout.jsonl"),
            "browser_stderr": str(directory / "browser.stderr.log"),
            "screenshot": str(directory / "post-operation.png"),
        },
        "error": result.get("error"),
    }
    validate_rq4_final_observation(row)
    return row


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def _run_observation(
    root: Path,
    run_dir: Path,
    config: dict[str, Any],
    scenario: dict[str, Any],
    index: int,
    content: str,
    master: dict[str, Any],
) -> dict[str, Any]:
    directory = run_dir / "observations" / scenario["id"] / f"measured-{index:03d}"
    directory.mkdir(parents=True)
    runtime = _copy_master_for_runtime(master, directory)
    deadline, port, web_port = (
        time.monotonic() + config["timeout_seconds"],
        free_port(),
        free_port(),
    )
    server: subprocess.Popen[str] | None = None
    result: dict[str, Any] = {
        "status": "failure",
        "failure_kind": "server_start_failure",
    }
    with (
        (directory / "server.stdout.log").open("w") as out,
        (directory / "server.stderr.log").open("w") as err,
    ):
        try:
            environment = {
                **os.environ,
                "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(
                    Path(runtime["path"]).parent
                ),
                "PHYLO_LENS_CORS_ORIGINS": f"http://127.0.0.1:{web_port}",
            }
            server = subprocess.Popen(
                [
                    str(root / ".venv/bin/python"),
                    "-m",
                    "uvicorn",
                    "phylo_lens_server.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                cwd=root,
                env=environment,
                text=True,
                stdout=out,
                stderr=err,
            )
            _wait_ready(port, server, deadline)
            control = {
                "api_url": f"http://127.0.0.1:{port}",
                "web_port": web_port,
                "browser_dist_path": str(root / "eval/browser/dist"),
                "browser": config["browser"],
                "content": content,
                "name": config["dataset"]["id"],
                "maxNodes": config["layout"]["max_nodes"],
                "operation": scenario["operation"],
                "input": scenario.get("input", {}),
                "target": scenario.get("target"),
                "prepared_result": {
                    "dataset_id": config["dataset"]["id"],
                    "layout_version": master["layout_id"],
                    "node_count": config["dataset"]["node_count"],
                    "edge_count": config["dataset"]["edge_count"],
                    "cluster_count": 9562,
                    "lod_tier_count": config["layout"]["lod_tier_count"],
                    "layout_status": "ready",
                    "warnings": [],
                },
                "setup_quiescence_ms": config["setup_quiescence_ms"],
                "baseline_frame_sample_count": config["baseline_frame_sample_count"],
                "timeout_ms": max(1, int((deadline - time.monotonic()) * 1000)),
                "screenshot_path": str(directory / "post-operation.png"),
            }
            write_json(directory / "request.json", control)
            completed = subprocess.run(
                [
                    "node",
                    str(root / "eval/browser/src/rq4-final-runner.mjs"),
                    str(directory / "request.json"),
                    str(directory / "browser-result.json"),
                ],
                cwd=root,
                text=True,
                capture_output=True,
                timeout=max(0.1, deadline - time.monotonic()),
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
                "failure_kind": "timeout",
                "error": str(error),
            }
        except Exception as error:
            result = {
                "status": "failure",
                "failure_kind": "protocol_failure",
                "error": str(error),
            }
        finally:
            if server is not None and server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
    if checksum_sha256(Path(master["path"])) != master["physical_sha256"]:
        result = {
            "status": "invalid",
            "failure_kind": "master_mutation",
            "error": "authoritative sealed master changed during observation",
        }
    runtime_database = Path(runtime["path"])
    runtime["final_main_sha256"] = checksum_sha256(runtime_database)
    runtime["sidecars"] = {
        suffix[1:]: {
            "exists": runtime_database.with_name(
                runtime_database.name + suffix
            ).exists(),
            "size_bytes": (
                runtime_database.with_name(runtime_database.name + suffix)
                .stat()
                .st_size
                if runtime_database.with_name(runtime_database.name + suffix).exists()
                else 0
            ),
        }
        for suffix in ("-wal", "-shm")
    }
    return _observation(
        config, run_dir.name, directory, scenario, index, master, runtime, result
    )


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    output = {
        "terminal_count": len(rows),
        "success_count": sum(item["status"] == "success" for item in rows),
        "failure_count": sum(item["status"] == "failure" for item in rows),
        "timeout_count": sum(item["status"] == "timeout" for item in rows),
        "invalid_count": sum(item["status"] == "invalid" for item in rows),
        "conditions": [],
    }
    for scenario in sorted({item["scenario"] for item in rows}):
        items, successful = (
            [item for item in rows if item["scenario"] == scenario],
            [
                item
                for item in rows
                if item["scenario"] == scenario and item["status"] == "success"
            ],
        )
        metrics = {
            key: summary(
                [
                    item["timing"][key]["value_ms"]
                    for item in successful
                    if item["timing"][key]["state"] == "available"
                ]
            )
            for key in (
                "settle_latency_ms",
                "event_to_request_ms",
                "browser_http_ms",
                "response_to_snapshot_ms",
                "event_to_snapshot_ms",
                "snapshot_to_settle_ms",
            )
        }
        output["conditions"].append(
            {
                "scenario": scenario,
                "observed": len(items),
                "success": len(successful),
                "metrics": metrics,
            }
        )
    return output


def run(args: argparse.Namespace) -> Path:
    root, config = repository_root(), load_config()
    _validate_run_id(args.run_id)
    final = bool(FINAL_RUN_ID_PATTERN.fullmatch(args.run_id))
    if final:
        _validate_final_product_isolation(root)
        _validate_final_worktree_clean(root)
    source = parse_canonical_source(
        root,
        {
            "dataset": {
                **config["dataset"],
                "expected_canonical_sha256": config["dataset"]["sha256"],
                "declared_node_count": config["dataset"]["node_count"],
                "declared_edge_count": config["dataset"]["edge_count"],
            }
        },
    )
    master = _verify_master(root, config, source)
    scenarios = [
        item
        for item in config["scenarios"]
        if not args.scenario or item["id"] in args.scenario
    ]
    repetitions = config["measured_repetitions"] if final else (args.repetitions or 1)
    if (
        not scenarios
        or repetitions < 1
        or (final and (len(scenarios) != 7 or repetitions != 7))
    ):
        raise ValueError(
            "Final RQ4 requires exactly 7 scenarios × 7 measured observations."
        )
    run_dir = create_isolated_run_directory(
        (args.results_root or root / "eval/results/raw").resolve(),
        EXPERIMENT_ID,
        args.run_id,
    )
    environment = capture_environment(root)
    manifest = {
        "schema_version": "1",
        "experiment_id": EXPERIMENT_ID,
        "run_id": args.run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": environment,
        "dataset": {
            "id": config["dataset"]["id"],
            "path": str(_source_path(root, config)),
            "checksum_sha256": config["dataset"]["sha256"],
            "format": "newick",
            "topology": "real phylogenetic tree",
            "declared_node_count": config["dataset"]["node_count"],
            "declared_edge_count": config["dataset"]["edge_count"],
        },
        "parameters": {
            "experiment_id": EXPERIMENT_ID,
            "dataset_ids": [config["dataset"]["id"]],
            "warmup_repetitions": 0,
            "measured_repetitions": repetitions,
            "timeout_seconds": config["timeout_seconds"],
            "persistence_backend": "sqlite",
        },
        "rq4": {
            "server_state_policy": "fresh_process_public_bootstrap_warm_session",
            "browser": config["browser"],
            "setup_quiescence_ms": config["setup_quiescence_ms"],
            "frame_budget_ms": 50,
            "minimum_frame_sample_count": 1,
            "scenario_ordering": "frozen-config-order",
        },
        "state": "running",
        "expected_terminal_observations": len(scenarios) * repetitions,
        "observed_terminal_observations": 0,
        "authoritative_master": master,
    }
    write_json(run_dir / "resolved-config.json", config)
    write_json(run_dir / "master-provenance.json", master)
    write_json(run_dir / "manifest.json", manifest)
    content, rows = _source_path(root, config).read_text(encoding="utf-8"), []
    for scenario in scenarios:
        for index in range(1, repetitions + 1):
            row = _run_observation(
                root, run_dir, config, scenario, index, content, master
            )
            write_json(Path(row["artifacts"]["directory"]) / "observation.json", row)
            _append_jsonl(run_dir / "observations.jsonl", row)
            rows.append(row)
            manifest["observed_terminal_observations"] = len(rows)
            write_json(run_dir / "manifest.json", manifest)
    write_json(run_dir / "summary.json", summarize(rows))
    manifest["state"] = "completed"
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="Run final RQ4 browser interactions.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--results-root", type=Path)
    parser.add_argument("--scenario", action="append")
    parser.add_argument("--repetitions", type=int)
    args = parser.parse_args()
    print(run(args))


if __name__ == "__main__":
    main()
