"""Frozen current-source MSAGLJS baseline utilities (evaluation-only)."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from .common import utc_now, write_json
from .rq1_final import load_config, repository_root, verified_conditions

UPSTREAM_COMMIT = "db1ecbba39f46ca83aa90a87bad2012757e51f42"
TIMEOUT_SECONDS = 300
RUN_ID_PATTERN = re.compile(r"thesis-msagljs-mds-v001-[0-9]{3}")


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


def run(args) -> Path:
    """Run the frozen 9-condition campaign; callers must provide a new raw ID."""
    if not RUN_ID_PATTERN.fullmatch(args.run_id):
        raise ValueError("run ID must match thesis-msagljs-mds-v001-[0-9]{3}")
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
    if getattr(args, "smoke", False):
        conditions = [item for item in conditions if item["id"] == "balanced-5000"]
    manifest = {
        "schema_version": "1",
        "state": "running",
        "run_id": args.run_id,
        "expected_raw_observations": 1 if getattr(args, "smoke", False) else 54,
        "created_utc": utc_now(),
        "provenance": {
            "msagljs_commit": UPSTREAM_COMMIT,
            "yarn_lock_sha256": sha256_bytes(lock.read_bytes()),
            "host": _host(),
            "timeout_seconds": TIMEOUT_SECONDS,
            "native_path": "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
            "paper_discrepancy": "paper IPSep-CoLa; pinned public loading benchmark MDS",
        },
    }
    write_json(run_dir / "manifest.json", manifest)
    rows = []
    for condition in conditions:
        adaptation = adapt_newick(Path(condition["absolute_path"]))
        validate_adaptation(
            adaptation, nodes=condition["parsed_nodes"], edges=condition["parsed_edges"]
        )
        plan = (
            [("smoke", 0, False)]
            if getattr(args, "smoke", False)
            else repetition_plan()
        )
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
            started = time.monotonic()
            command = [
                "node",
                str(root / "eval/browser/src/msagl-runner.mjs"),
                str(core),
                str(graph),
                str(TIMEOUT_SECONDS),
            ]
            try:
                done = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=TIMEOUT_SECONDS + 30,
                    check=False,
                )
                payload = json.loads(done.stdout.strip().splitlines()[-1])
                state = (
                    payload.get("status", "failure")
                    if done.returncode == 0
                    else "failure"
                )
            except subprocess.TimeoutExpired as error:
                payload = {"error": str(error)}
                state = "timeout"
            except Exception as error:
                payload = {"error": f"{type(error).__name__}: {error}"}
                state = "failure"
            row = {
                "observation_id": oid,
                "condition_id": condition["id"],
                "warmup": warmup,
                "repetition_index": index,
                "state": state,
                "timeout_seconds": TIMEOUT_SECONDS,
                "source_sha256": adaptation["source_sha256"],
                "adapted_sha256": adaptation["adapted_sha256"],
                "node_count": adaptation["node_count"],
                "edge_count": adaptation["edge_count"],
                "native": payload,
                "wall_seconds": time.monotonic() - started,
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
