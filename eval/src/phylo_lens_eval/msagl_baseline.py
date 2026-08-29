"""Frozen current-source MSAGLJS baseline utilities (evaluation-only)."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

from .common import utc_now, write_json
from .rq1_final import load_config, repository_root, verified_conditions

UPSTREAM_COMMIT = "db1ecbba39f46ca83aa90a87bad2012757e51f42"
TIMEOUT_SECONDS = 300
RUN_ID_PATTERN = re.compile(r"thesis-msagljs-mds-v001-[0-9]{3}")
DEVELOPMENT_SMOKE_RUN_ID_PATTERN = re.compile(r"dev-msagljs-mds-smoke-[0-9]{3}")
TILE_LEVEL_UPPER_BOUND = 30
TILE_CAPACITY = 500
NATIVE_MAX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def newick_edges(text: str) -> tuple[set[str], set[tuple[str, str]]]:
    """Parse the retained rooted Newick topology into canonical undirected edges."""
    tokens = re.findall(r"[(),;]|[^(),;\s]+", text)
    stack: list[str] = []
    nodes: set[str] = set()
    edges: set[tuple[str, str]] = set()
    next_id = 0
    expecting_child = True
    for token in tokens:
        if token == "(":
            node = f"internal-{next_id}"
            next_id += 1
            nodes.add(node)
            if stack:
                edges.add(tuple(sorted((stack[-1], node))))
            stack.append(node)
            expecting_child = True
        elif token == ",":
            expecting_child = True
        elif token == ")":
            if not stack:
                raise ValueError("unbalanced Newick")
            stack.pop()
            expecting_child = False
        elif token == ";":
            continue
        elif expecting_child:
            node = token.split(":", 1)[0]
            if not stack or not node:
                raise ValueError("invalid Newick leaf")
            if node in nodes:
                raise ValueError("duplicate Newick label")
            nodes.add(node)
            edges.add(tuple(sorted((stack[-1], node))))
            expecting_child = False
    if stack or not nodes:
        raise ValueError("unbalanced or empty Newick")
    return nodes, edges


def adapt_newick(source: Path) -> dict:
    """Return deterministic UTF-8 edge-list bytes and equality witnesses."""
    original = source.read_bytes()
    nodes, edges = newick_edges(original.decode("utf-8"))
    payload = "".join(f"{a}\t{b}\n" for a, b in sorted(edges)).encode("utf-8")
    return {
        "source_sha256": sha256_bytes(original),
        "adapted_sha256": sha256_bytes(payload),
        "nodes": sorted(nodes),
        "edges": sorted(edges),
        "payload": payload,
        "node_count": len(nodes),
        "edge_count": len(edges),
    }


def validate_adaptation(adaptation: dict, *, nodes: int, edges: int) -> None:
    if adaptation["node_count"] != nodes or adaptation["edge_count"] != edges:
        raise ValueError("adapted graph does not preserve node/edge counts")
    if len(set(adaptation["edges"])) != edges:
        raise ValueError("adapted graph has duplicate edges")


def selected_conditions(root: Path | None = None) -> list[dict]:
    root = root or repository_root()
    return [
        item
        for item in verified_conditions(root, load_config(root))
        if item["requested_leaves"] in {5000, 10000, 25000}
    ]


def repetition_plan() -> list[tuple[str, int, bool]]:
    return [("warmup", 0, True), *(("measured", i, False) for i in range(5))]


def _host() -> dict:
    return {
        "os": os.uname().sysname,
        "release": os.uname().release,
        "machine": os.uname().machine,
        "python": sys.version.split()[0],
    }


def _run_child(command: list[str], deadline_seconds: float) -> dict:
    """Run one observation in its own process group with a hard outer deadline."""
    child = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    started = time.monotonic()
    try:
        stdout, stderr = child.communicate(timeout=deadline_seconds)
        return {
            "timed_out": False,
            "returncode": child.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "elapsed_seconds": time.monotonic() - started,
            "process_group_terminated": False,
        }
    except subprocess.TimeoutExpired:
        # Node starts Chromium below it. Killing this new session's process group is
        # independent of Playwright/page timers, so synchronous JS cannot evade the
        # frozen observation deadline.
        os.killpg(child.pid, signal.SIGKILL)
        stdout, stderr = child.communicate()
        return {
            "timed_out": True,
            "returncode": child.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "elapsed_seconds": time.monotonic() - started,
            "process_group_terminated": True,
        }


def _execute_observation(
    command: list[str], directory: Path, deadline_seconds: float
) -> tuple[str, dict, dict]:
    """Retain runner diagnostics and return a terminal classification once only."""
    outcome = _run_child(command, deadline_seconds)
    (directory / "runner.stdout.txt").write_text(outcome["stdout"])
    (directory / "runner.stderr.txt").write_text(outcome["stderr"])
    watchdog = {
        key: outcome[key]
        for key in (
            "timed_out",
            "returncode",
            "elapsed_seconds",
            "process_group_terminated",
        )
    }
    write_json(directory / "outer-watchdog.json", watchdog)
    if outcome["timed_out"]:
        return "timeout", {"outer_watchdog": watchdog}, watchdog
    try:
        payload = json.loads(outcome["stdout"].strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        return (
            "failure",
            {
                "error": f"runner output is not terminal JSON: {error}",
                "outer_watchdog": watchdog,
            },
            watchdog,
        )
    state = (
        payload.get("status", "failure") if outcome["returncode"] == 0 else "failure"
    )
    payload["outer_watchdog"] = watchdog
    return state, payload, watchdog


def _validate_native_success(payload: dict, adaptation: dict) -> str | None:
    """Check that a reported native success is internally usable raw evidence."""
    if payload.get("nodes") != adaptation["node_count"]:
        return "native node count does not match adapted graph"
    if payload.get("edges") != adaptation["edge_count"]:
        return "native edge count does not match adapted graph"
    if payload.get("tile_level_upper_bound") != TILE_LEVEL_UPPER_BOUND:
        return "unexpected TileMap level upper bound"
    if payload.get("tile_capacity") != TILE_CAPACITY:
        return "unexpected TileMap tile capacity"
    if payload.get("native_max_memory_bytes") != NATIVE_MAX_MEMORY_BYTES:
        return "unexpected native TileMap memory budget"
    actual_levels = payload.get("actual_levels_built")
    if (
        not isinstance(actual_levels, int)
        or not 0 < actual_levels <= TILE_LEVEL_UPPER_BOUND
    ):
        return "invalid actual TileMap level count"
    if payload.get("tile_map_number_of_levels") != actual_levels:
        return "TileMap returned level count does not match native level count"
    evidence = payload.get("execution_evidence", {})
    if not (
        evidence.get("mds_layout_settings_constructed")
        and evidence.get("layout_graph_with_mds_called")
        and evidence.get("edge_routing_mode") == "Sleeve"
        and evidence.get("tile_map_build_completed")
    ):
        return "incomplete native MDS/Sleeve/TileMap execution evidence"
    required = (
        "parse_ms",
        "geometry_ms",
        "layout_ms",
        "cdt_ms",
        "routing_ms",
        "routing_phases_ms",
        "tiling_ms",
        "other_ms",
        "total_ms",
    )
    if any(not isinstance(payload.get(key), (int, float)) for key in required):
        return "missing native timing field"
    if payload["total_ms"] <= 0 or any(payload[key] < 0 for key in required):
        return "invalid native timing value"
    if (
        abs(payload["routing_phases_ms"] - payload["cdt_ms"] - payload["routing_ms"])
        > 0.01
    ):
        return "routing phase timing is not reconcilable"
    if payload["cdt_ms"] <= 0 or payload["routing_ms"] <= 0:
        return "native sleeve CDT/routing phases were not observed"
    reconciled = (
        payload["parse_ms"]
        + payload["geometry_ms"]
        + payload["layout_ms"]
        + payload["tiling_ms"]
        + payload["other_ms"]
    )
    if abs(payload["total_ms"] - reconciled) > 0.1:
        return "top-level timing is not reconcilable"
    browser = payload.get("browser", {})
    if browser.get("page_errors") != [] or not browser.get("clean_exit"):
        return "browser did not exit cleanly without page errors"
    return None


def run(args) -> Path:
    """Run the frozen 9-condition campaign; callers must provide a new raw ID."""
    smoke = getattr(args, "smoke", False)
    if not (
        RUN_ID_PATTERN.fullmatch(args.run_id)
        or (smoke and DEVELOPMENT_SMOKE_RUN_ID_PATTERN.fullmatch(args.run_id))
    ):
        raise ValueError(
            "run ID must match thesis-msagljs-mds-v001-[0-9]{3}; "
            "development smoke IDs must match dev-msagljs-mds-smoke-[0-9]{3}"
        )
    if DEVELOPMENT_SMOKE_RUN_ID_PATTERN.fullmatch(args.run_id) and not smoke:
        raise ValueError("development smoke IDs require --smoke")
    root = repository_root()
    results = (args.results_root or root / "eval/results/raw").resolve()
    run_dir = results / "rq5-msagljs-current-mds-v001" / args.run_id
    if run_dir.exists():
        raise FileExistsError(f"immutable raw run directory exists: {run_dir}")
    upstream = Path(args.upstream).resolve()
    core = upstream / "modules/core/dist.min.js"
    lock = upstream / "yarn.lock"
    if not core.is_file() or not lock.is_file():
        raise FileNotFoundError("pinned MSAGLJS build or yarn.lock missing")
    if (
        subprocess.run(
            ["git", "-C", str(upstream), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        != UPSTREAM_COMMIT
    ):
        raise ValueError("unexpected MSAGLJS upstream commit")
    run_dir.mkdir(parents=True)
    conditions = selected_conditions(root)
    if smoke:
        conditions = [item for item in conditions if item["id"] == "balanced-5000"]
    manifest = {
        "schema_version": "1",
        "state": "running",
        "run_id": args.run_id,
        "run_kind": "development_smoke" if smoke else "final_campaign",
        "development_evidence_only": smoke,
        "expected_raw_observations": 1 if smoke else 54,
        "created_utc": utc_now(),
        "provenance": {
            "msagljs_commit": UPSTREAM_COMMIT,
            "yarn_lock_sha256": sha256_bytes(lock.read_bytes()),
            "host": _host(),
            "timeout_seconds": TIMEOUT_SECONDS,
            "native_path": "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
            "paper_discrepancy": "paper IPSep-CoLa; pinned public loading benchmark MDS",
            "tile_map": {
                "tile_level_upper_bound": TILE_LEVEL_UPPER_BOUND,
                "tile_capacity": TILE_CAPACITY,
                "native_max_memory_bytes": NATIVE_MAX_MEMORY_BYTES,
                "stopping_semantics": (
                    "buildUpToLevel upper bound; native stops at tile-size/capacity "
                    "conditions or discards a partial level at the memory budget"
                ),
                "pinned_example_max_tile_levels": 8,
            },
            "timing": {
                "total_ms_boundary": (
                    "immediately before adapted payload parsing through successful "
                    "TileMap.buildUpToLevel return"
                ),
                "browser_startup_outside_total_ms": True,
                "routing_phases_subset_of_layout_ms": True,
                "other_ms": "total_ms - parse_ms - geometry_ms - layout_ms - tiling_ms",
                "not_example_published_total_ms": True,
            },
            "browser_lifecycle": (
                "one fresh Chromium process and one fresh context/page per observation; "
                "browser startup is outside total_ms"
            ),
            "outer_watchdog": {
                "deadline_seconds": TIMEOUT_SECONDS,
                "scope": "new Node process group including Chromium descendants",
                "signal": "SIGKILL",
            },
            "repetition_policy": {
                "warmups_per_condition": 1,
                "measured_per_condition": 5,
                "retries_permitted": 0,
            },
        },
    }
    write_json(run_dir / "manifest.json", manifest)
    rows = []
    for condition in conditions:
        adaptation = adapt_newick(Path(condition["absolute_path"]))
        validate_adaptation(
            adaptation, nodes=condition["parsed_nodes"], edges=condition["parsed_edges"]
        )
        plan = [("smoke", 0, False)] if smoke else repetition_plan()
        for phase, index, warmup in plan:
            oid = f"{phase}-{index:03d}-{condition['id']}"
            directory = run_dir / "conditions" / condition["id"] / oid
            directory.mkdir(parents=True)
            graph = directory / "graph.tsv"
            graph.write_bytes(adaptation["payload"])
            write_json(
                directory / "adaptation.json",
                {
                    k: v
                    for k, v in adaptation.items()
                    if k not in {"payload", "nodes", "edges"}
                },
            )
            command = [
                "node",
                str(root / "eval/browser/src/msagl-runner.mjs"),
                str(core),
                str(graph),
                str(TIMEOUT_SECONDS),
            ]
            state, payload, watchdog = _execute_observation(
                command, directory, TIMEOUT_SECONDS
            )
            if state == "success":
                validation_error = _validate_native_success(payload, adaptation)
                if validation_error:
                    state = "failure"
                    payload["validation_error"] = validation_error
            row = {
                "observation_id": oid,
                "condition_id": condition["id"],
                "warmup": warmup,
                "repetition_index": index,
                "state": state,
                "attempt_count": 1,
                "retry_permitted": False,
                "timeout_seconds": TIMEOUT_SECONDS,
                "source_sha256": adaptation["source_sha256"],
                "adapted_sha256": adaptation["adapted_sha256"],
                "node_count": adaptation["node_count"],
                "edge_count": adaptation["edge_count"],
                "native": payload,
                "outer_watchdog": watchdog,
                "wall_seconds": watchdog["elapsed_seconds"],
            }
            write_json(directory / "observation.json", row)
            rows.append(row)
            with (run_dir / "observations.jsonl").open("a") as f:
                f.write(json.dumps(row, sort_keys=True) + "\n")
    manifest["state"] = "completed"
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the frozen MSAGLJS MDS baseline.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--results-root", type=Path)
    parser.add_argument("--smoke", action="store_true")
    print(run(parser.parse_args()))


if __name__ == "__main__":
    main()
