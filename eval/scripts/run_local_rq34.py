"""Run development RQ3/RQ4 from local source, without a product release.

Results deliberately use a separate local protocol and directory. Frozen final
release configurations, layouts, targets and observation schemas are untouched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import statistics
import subprocess
import sys
import time
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def write(path, value):
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def command(args, cwd):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def file_hash(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def validate_rq3(dataset, store, version, cuts):
    """Independent persisted partition/quotient checks, O(L*(N+E))."""
    ids = {node.id for node in dataset.nodes}
    adjacency = defaultdict(list)
    for edge in dataset.edges:
        adjacency[edge.source].append(edge.target)
        adjacency[edge.target].append(edge.source)
    depths = {}
    queue = deque((root, 0) for root in dataset.technical_roots)
    while queue:
        node, depth = queue.popleft()
        if node in depths:
            continue
        depths[node] = depth
        queue.extend(
            (child, depth + 1) for child in adjacency[node] if child not in depths
        )
    assert set(depths) == ids
    histogram = Counter(depths.values())
    rows, previous = [], None
    with sqlite3.connect(store.path) as connection:
        connection.row_factory = sqlite3.Row
        persisted_edges = {
            tuple(row)
            for row in connection.execute(
                "select edge_id,source_node_id,target_node_id,distance from graph_edges where dataset_id=? and layout_version=?",
                (dataset.dataset_id, version),
            )
        }
        assert persisted_edges == {
            (edge.id, edge.source, edge.target, edge.distance) for edge in dataset.edges
        }
        positions = {
            r[0]: (r[1], r[2])
            for r in connection.execute(
                "select node_id,x,y from node_positions where dataset_id=? and layout_version=?",
                (dataset.dataset_id, version),
            )
        }
        assert set(positions) == ids
        for level, cut in enumerate(cuts):
            clusters = list(
                connection.execute(
                    "select cluster_id,representative_node_id,member_count from prepared_clusters where dataset_id=? and layout_version=? and lod_level=?",
                    (dataset.dataset_id, version, level),
                )
            )
            members = defaultdict(list)
            for cluster, node in connection.execute(
                "select m.cluster_id,m.node_id from cluster_members m join prepared_clusters c using(dataset_id,layout_version,cluster_id) where m.dataset_id=? and m.layout_version=? and c.lod_level=?",
                (dataset.dataset_id, version, level),
            ):
                members[cluster].append(node)
            owner, representative = {}, {}
            collapsed = 0
            for cluster in clusters:
                group = members[cluster["cluster_id"]]
                assert len(group) == cluster["member_count"]
                anchor = cluster["representative_node_id"]
                assert anchor in group
                if previous is not None:
                    assert len({previous[node] for node in group}) == 1
                if len(group) > 1:
                    collapsed += 1
                    assert depths[anchor] == cut + 1
                    assert all(depths[node] > cut for node in group)
                for node in group:
                    assert node not in owner
                    owner[node] = cluster["cluster_id"]
                    representative[node] = anchor
                    if depths[node] <= cut:
                        assert group == [node]
            assert set(owner) == ids
            internal, boundary, quotient = Counter(), Counter(), set()
            quotient_distances = set()
            for edge in dataset.edges:
                a, b = owner[edge.source], owner[edge.target]
                if a == b:
                    internal[a] += 1
                else:
                    boundary[a] += 1
                    boundary[b] += 1
                    quotient.add(
                        tuple(
                            sorted(
                                (
                                    representative[edge.source],
                                    representative[edge.target],
                                )
                            )
                        )
                    )
                    quotient_distances.add(
                        (
                            tuple(
                                sorted(
                                    (
                                        representative[edge.source],
                                        representative[edge.target],
                                    )
                                )
                            ),
                            edge.distance,
                        )
                    )
            for cluster in clusters:
                # In an acyclic source, |S|-1 internal edges proves connectedness.
                assert internal[cluster["cluster_id"]] == cluster["member_count"] - 1
                if cluster["member_count"] > 1:
                    assert boundary[cluster["cluster_id"]] == 1
            view = store.read_viewport(
                dataset_id=dataset.dataset_id,
                layout_version=version,
                xmin=None,
                xmax=None,
                ymin=None,
                ymax=None,
                lod_level=level,
            )
            assert not view.truncated and len(view.nodes) == len(clusters)
            assert all(
                (node.x, node.y) == positions[node.node_id] for node in view.nodes
            )
            assert {tuple(sorted((e.source, e.target))) for e in view.edges} == quotient
            assert {
                (tuple(sorted((e.source, e.target))), e.distance) for e in view.edges
            } == quotient_distances
            expected = (
                sum(count for depth, count in histogram.items() if depth <= cut)
                + histogram[cut + 1]
            )
            assert len(view.nodes) == expected
            if level == len(cuts) - 1:
                assert collapsed == 0 and len(view.nodes) == len(ids)
            rows.append(
                {
                    "level": level,
                    "hop_depth": cut,
                    "representations": len(view.nodes),
                    "edges": len(view.edges),
                    "aggregates": collapsed,
                    "reduction_fraction": 1 - len(view.nodes) / len(ids),
                    "invariants": "PASS",
                }
            )
            previous = owner
    return rows


def frame_stats(values):
    if not values:
        return {}
    values = sorted(values)
    return {
        "count": len(values),
        "median_ms": values[len(values) // 2],
        "p95_ms": values[min(len(values) - 1, int(len(values) * 0.95))],
        "max_ms": values[-1],
    }


def run_rq4(args, directory, dataset, prepared, store, content, env):
    port, web_port = free_port(), free_port()
    server_env = {
        **env,
        "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(store.path.parent),
        "PHYLO_LENS_PREPARE_JOB_BACKEND": "local",
        "PHYLO_LENS_CORS_ORIGINS": f"http://127.0.0.1:{web_port}",
    }
    rows = []
    with (directory / "server.log").open("w") as log:
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
            env=server_env,
            cwd=args.product_root,
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/health", timeout=1
                    ).close()
                    break
                except (OSError, TimeoutError):
                    if server.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError(
                            "Local server failed to become ready; see server.log"
                        )
                    time.sleep(0.2)
            scenarios = [("navigation", "viewport_navigation", None)]
            for rank in ("low", "representative", "high"):
                scenarios += [
                    (f"expand-{rank}", "cluster_expand", rank),
                    (f"collapse-{rank}", "cluster_collapse", rank),
                ]
            if args.scenario:
                scenarios = [item for item in scenarios if item[0] in args.scenario]
            for scenario, operation, rank in scenarios:
                for repetition in range(args.repetitions):
                    path = directory / scenario / f"{repetition + 1:03}"
                    path.mkdir(parents=True)
                    control = {
                        "local_development": True,
                        "api_url": f"http://127.0.0.1:{port}",
                        "web_port": web_port,
                        "browser_dist_path": str(ROOT / "eval/browser/dist"),
                        "browser": {
                            "headless": args.headless,
                            "viewport": {"width": 960, "height": 640},
                            "device_scale_factor": 1,
                            "locale": "en-US",
                            "timezone": "UTC",
                            "launch_args": [],
                        },
                        "content": content,
                        "name": args.dataset.stem,
                        "operation": operation,
                        "target_rank": rank,
                        "input": {"client_x": 20, "client_y": 20},
                        "prepared_result": prepared,
                        "setup_quiescence_ms": 2000,
                        "baseline_frame_sample_count": 12,
                        "timeout_ms": args.timeout * 1000,
                        "screenshot_path": str(path / "after.png"),
                    }
                    write(path / "control.json", control)
                    print(
                        f"RQ4 {scenario} {repetition + 1}/{args.repetitions}",
                        flush=True,
                    )
                    with (path / "browser.log").open("w") as browser_log:
                        try:
                            subprocess.run(
                                [
                                    "node",
                                    str(ROOT / "eval/browser/src/rq4-final-runner.mjs"),
                                    str(path / "control.json"),
                                    str(path / "result.json"),
                                ],
                                cwd=ROOT,
                                stdout=browser_log,
                                stderr=browser_log,
                                timeout=args.timeout + 120,
                                check=True,
                            )
                            result = json.loads((path / "result.json").read_text())
                        except (
                            OSError,
                            subprocess.SubprocessError,
                            ValueError,
                        ) as error:
                            result = {"status": "failure", "error": str(error)}
                            write(path / "result.json", result)
                    initial = result.get("pre_operation", {}).get("boundary", {})
                    after = result.get("event", {}).get("boundary", {})
                    input_event = result.get("input_event") or {}
                    start = input_event.get("timestamp", input_event.get("t0"))
                    settled = result.get("t_settled")
                    # Keep the complete clock evidence; summarize only actual native-input timing.
                    latency = (
                        settled - start
                        if isinstance(start, (int, float))
                        and isinstance(settled, (int, float))
                        else None
                    )
                    if result["status"] == "success" and (
                        not input_event.get("isTrusted")
                        or latency is None
                        or latency < 0
                        or after.get("sequence", 0) <= initial.get("sequence", 0)
                    ):
                        result["status"] = "invalid"
                        result["error"] = (
                            "Missing valid native-input timing or post-input snapshot"
                        )
                    rows.append(
                        {
                            "scenario": scenario,
                            "repetition": repetition + 1,
                            "status": result["status"],
                            "error": result.get("error"),
                            "settle_ms": latency,
                            "frames": frame_stats(result.get("frame_intervals_ms", [])),
                            "before": initial,
                            "after": after,
                            "target": result.get("target"),
                            "artifact": str(path / "result.json"),
                        }
                    )
                    write(directory / "observations.json", rows)
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    return rows


def summarize_rq4(rows):
    summary = {}
    for scenario in sorted({row["scenario"] for row in rows}):
        selected = [row for row in rows if row["scenario"] == scenario]
        successful = [row for row in selected if row["status"] == "success"]
        timings = [
            row["settle_ms"] for row in successful if row["settle_ms"] is not None
        ]
        targets = {
            (row["target"]["clusterId"], row["target"]["representedNodeCount"])
            for row in successful
            if row.get("target")
        }
        summary[scenario] = {
            "successes": len(successful),
            "observations": len(selected),
            "median_settle_ms": statistics.median(timings) if timings else None,
            "min_settle_ms": min(timings) if timings else None,
            "max_settle_ms": max(timings) if timings else None,
            "targets": [
                {"cluster_id": target, "members": count}
                for target, count in sorted(targets)
            ],
        }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product-root", type=Path, default=ROOT)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument(
        "--run-id",
        default="local-rq34-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"),
    )
    parser.add_argument(
        "--results-root", type=Path, default=ROOT / "eval/results/local"
    )
    parser.add_argument("--repetitions", type=int, default=7)
    parser.add_argument(
        "--scenario",
        action="append",
        choices=[
            "navigation",
            "expand-low",
            "collapse-low",
            "expand-representative",
            "collapse-representative",
            "expand-high",
            "collapse-high",
        ],
        help="Run only these RQ4 scenarios (repeatable)",
    )
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--rq3-only", action="store_true")
    parser.add_argument(
        "--layout-dir",
        type=Path,
        help="Reuse a local prepared layout with the same dataset and current layout fingerprint",
    )
    args = parser.parse_args()
    args.product_root = args.product_root.resolve()
    if args.layout_dir:
        args.layout_dir = args.layout_dir.resolve()
    if args.repetitions < 1 or Path(args.run_id).name != args.run_id:
        parser.error("A positive repetition count and simple run ID are required")
    sys.path.insert(0, str(args.product_root / "code/server/src"))
    from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
    from phylo_lens_server.pipeline.clustering import (
        rooted_depths,
        selected_depths,
        tree_adjacency,
    )
    from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
    from phylo_lens_server.repository.layout.sqlite_layout_repository import (
        PreparedLayoutStore,
    )

    directory = (args.results_root / args.run_id).resolve()
    directory.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(Path(__file__), directory / "harness-snapshot.py")
    shutil.copyfile(
        ROOT / "eval/browser/src/rq4-final-runner.mjs",
        directory / "browser-runner-snapshot.mjs",
    )
    content = args.dataset.read_text()
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick", dataset_name=args.dataset.stem, content=content
        )
    ).dataset
    env = {**os.environ, "PYTHONPATH": str(args.product_root / "code/server/src")}
    provenance = {
        "protocol": "local-development-rq34-v1",
        "published_release": False,
        "timing_boundary": "trusted native input to next applied snapshot plus two animation frames",
        "navigation_input": "native mouse wheel deltaY=-500 at (20,20)",
        "expansion_setup": "public collapseAll then setKeepExpanded(true); rank visible coarsest aggregates by membership",
        "harness_sha256": file_hash(Path(__file__)),
        "browser_runner_sha256": file_hash(
            ROOT / "eval/browser/src/rq4-final-runner.mjs"
        ),
        "product_root": str(args.product_root),
        "product_source_sha256": {
            str(path.relative_to(args.product_root)): file_hash(path)
            for folder, suffixes in [
                ("code/server/src", {".py"}),
                ("code/client/src", {".ts", ".css"}),
            ]
            for path in sorted((args.product_root / folder).rglob("*"))
            if path.is_file() and path.suffix in suffixes
        },
        "commit": command(["git", "rev-parse", "HEAD"], args.product_root),
        "dirty_diff_sha256": hashlib.sha256(
            command(
                ["git", "diff", "HEAD", "--", "code/server", "code/client"],
                args.product_root,
            ).encode()
        ).hexdigest(),
        "dataset_path": str(args.dataset.resolve()),
        "dataset_sha256": file_hash(args.dataset),
        "nodes": len(dataset.nodes),
        "edges": len(dataset.edges),
        "python": sys.version,
        "graphviz": subprocess.run(
            ["sfdp", "-V"], capture_output=True, text=True, check=True
        ).stderr.strip(),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "repetitions": args.repetitions,
        "headless": args.headless,
    }
    write(directory / "manifest.json", provenance)
    store = PreparedLayoutStore(args.layout_dir or directory / "prepared-layout")
    stages = []
    from contextlib import contextmanager

    @contextmanager
    def stage(name):
        start = time.perf_counter()
        print("Preparation:", name, flush=True)
        yield
        stages.append({"stage": name, "seconds": time.perf_counter() - start})
        write(directory / "preparation-stages.json", stages)

    if args.layout_dir:
        from phylo_lens_server.pipeline.ingest import layout_version_for_dataset

        version = layout_version_for_dataset(dataset)
        with sqlite3.connect(store.path) as connection:
            count = connection.execute(
                "select count(*) from node_positions where dataset_id=? and layout_version=?",
                (dataset.dataset_id, version),
            ).fetchone()[0]
        if count != len(dataset.nodes):
            raise ValueError(
                "Reusable layout does not match the dataset and current product fingerprint"
            )
        provenance["reused_layout"] = str(store.path.resolve())
        write(directory / "manifest.json", provenance)
    else:
        result = PreparedLayoutWorker(store, stage_factory=stage).prepare_dataset(
            dataset
        )
        version = result.artifacts.layout_version
    depths = rooted_depths(tree_adjacency(dataset), dataset.technical_roots)
    cuts = selected_depths(depths)
    rq3 = validate_rq3(dataset, store, version, cuts)
    write(directory / "rq3.json", rq3)
    write(
        directory / "layout.json",
        {
            "layout_version": version,
            "cuts": cuts,
            "database": str(store.path),
            "database_bytes": store.path.stat().st_size,
            "sum_representations": sum(r["representations"] for r in rq3),
            "membership_rows": len(dataset.nodes) * len(cuts),
        },
    )
    print("RQ3: all", len(cuts), "prepared tiers PASS", flush=True)
    if not args.rq3_only:
        # Build the exact product library, then the existing evaluation page.
        subprocess.run(
            ["npm", "run", "build:lib"],
            cwd=args.product_root / "code/client",
            check=True,
        )
        target = args.product_root / "code/client/dist/index.js"
        subprocess.run(
            ["npm", "run", "build"],
            cwd=ROOT / "eval/browser",
            env={**os.environ, "PHYLO_LENS_EVAL_PRODUCT_ROOT": str(args.product_root)},
            check=True,
        )
        provenance["client_bundle_sha256"] = file_hash(target)
        write(directory / "manifest.json", provenance)
        prepared = {
            "dataset_id": dataset.dataset_id,
            "layout_version": version,
            "node_count": len(dataset.nodes),
            "edge_count": len(dataset.edges),
            "cluster_count": sum(r["representations"] for r in rq3),
            "lod_tier_count": len(cuts),
            "layout_status": "ready",
            "warnings": [],
        }
        browser_dir = directory / "rq4"
        browser_dir.mkdir()
        rows = run_rq4(args, browser_dir, dataset, prepared, store, content, env)
        write(
            directory / "summary.json",
            {
                "rq3": "PASS",
                "rq4_successes": sum(r["status"] == "success" for r in rows),
                "rq4_observations": len(rows),
                "scenarios": summarize_rq4(rows),
                "protocol": provenance["protocol"],
            },
        )
    print(directory, flush=True)
    if not args.rq3_only and any(row["status"] != "success" for row in rows):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
