"""Local RQ2/RQ4 evidence for an unpublished product checkout; never edits product."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sqlite3
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from run_local_rq34 import ROOT, file_hash, free_port, write

COMMIT = "2a315171ece6812fdee7c8f87aba825eca183451"
DATA_SHA = "81b2a8a2646335f9217ad957f3879f3f34011866373ed514879b1304e75e2059"
VERSION = "d64decd05f7148a9"
DATASET = "tree_fullmst_100000"
TARGET_RULE = (
    "All non-singleton prepared cluster records sorted by count, level, ID. "
    "Nearest-rank (rounded index) quantiles 0.10/0.50/0.99; medium count raised "
    "to nearest available count >=2*small if necessary; large >=2*medium. "
    "For each count choose lowest level then lexicographically smallest ID."
)


def targets(connection):
    rows = connection.execute(
        "select cluster_id,lod_level,member_count,representative_node_id,x,y "
        "from prepared_clusters where member_count>1 order by member_count,lod_level,cluster_id"
    ).fetchall()
    counts = sorted({r[2] for r in rows})
    selected = []
    for label, quantile in zip(("small", "medium", "large"), (0.1, 0.5, 0.99)):
        desired = rows[round(quantile * (len(rows) - 1))][2]
        minimum = selected[-1]["member_count"] * 2 if selected else 2
        count = min(
            (n for n in counts if n >= minimum), key=lambda n: (abs(n - desired), n)
        )
        row = next(r for r in rows if r[2] == count)
        selected.append(
            dict(
                zip(
                    (
                        "cluster_id",
                        "lod_level",
                        "member_count",
                        "attachment_node_id",
                        "x",
                        "y",
                    ),
                    row,
                ),
                scenario=label,
                desired_quantile_count=desired,
                quantile=quantile,
            )
        )
    assert len({r["cluster_id"] for r in selected}) == 3
    assert len({r["member_count"] for r in selected}) == 3
    return {
        "rule": TARGET_RULE,
        "non_singleton_records": len(rows),
        "targets": selected,
    }


def frames(values):
    values = sorted(values)
    if not values:
        return {"count": 0}
    above = sum(value > 50 for value in values)
    return {
        "count": len(values),
        "median_ms": statistics.median(values),
        "p95_ms": values[math.ceil(0.95 * len(values)) - 1],
        "max_ms": max(values),
        "above_50ms_count": above,
        "above_50ms_proportion": above / len(values),
    }


def condition_queries():
    # Controlled camera windows, not forced effective tiers. The server performs
    # the identical normal count-based selection and 50%-padded retrieval.
    conditions = [
        ("viewport-smaller", 0.45625, 0.63449, 0.01),
        ("viewport-few-thousand", 1.1, 1.3, 0.02),
        ("viewport-larger", 0.5, 0.95, 0.16),
        ("viewport-largest-discovered", 1.6646, 1.0611, 0.08),
    ]
    result = []
    for name, x, y, ratio in conditions:
        width, height = 6.36 * ratio, 5.49 * ratio
        bounds = {
            "xmin": x - width / 2,
            "xmax": x + width / 2,
            "ymin": y - height / 2,
            "ymax": y + height / 2,
        }
        preferred = min(
            14, 1 + max(0, math.ceil(math.log(ratio / (0.8 * 2 / 3), 2 / 3)))
        )
        query = {
            "dataset_id": DATASET,
            "layout_version": VERSION,
            "zoom": 1 / ratio,
            "lod_level": preferred,
            "lod_target_representations": 1066,
            "lod_selection_bounds": bounds,
            "xmin": x - width,
            "xmax": x + width,
            "ymin": y - height,
            "ymax": y + height,
        }
        result.append({"condition": name, "camera_ratio": ratio, "query": query})
    return result


def phases(result):
    event = result.get("event", {}).get("timestamp")
    start = (result.get("input_event") or {}).get("timestamp")
    end = result.get("t_settled")
    requests = result.get("relevant_requests", [])
    request = requests[-1] if requests else None
    out = {
        "interaction_display_ms": end - start
        if end is not None and start is not None
        else None
    }
    if request and event is not None and start is not None:
        issued, response = (
            request.get("fetchInvocationTimestamp"),
            request.get("responseTimestamp"),
        )
        out.update(
            input_to_request_ms=issued - start,
            http_interval_ms=response - issued if response is not None else None,
            response_to_snapshot_ms=event - response if response is not None else None,
            snapshot_to_two_raf_ms=end - event,
        )
    elif event is not None and start is not None:
        out.update(
            input_to_snapshot_ms=event - start, snapshot_to_two_raf_ms=end - event
        )
    return out


def summarize(rows):
    result = {}
    for key in sorted({r["condition"] for r in rows}):
        selected = [r for r in rows if r["condition"] == key and not r["warmup"]]
        good = [r for r in selected if r["valid"]]
        metrics = {
            name: statistics.median(
                [
                    r["timing"][name]
                    for r in good
                    if isinstance(r["timing"].get(name), (float, int))
                ]
            )
            for name in {
                n
                for r in good
                for n, v in r["timing"].items()
                if isinstance(v, (float, int))
            }
        }
        result[key] = {
            "observations": len(selected),
            "valid": len(good),
            "median_timing": metrics,
            "pooled_frames": frames([v for r in good for v in r["frame_intervals_ms"]]),
            "response": good[0].get("response") if good else None,
            "target": good[0].get("target") if good else None,
            "median_heap_delta_bytes": statistics.median(
                [r["heap_delta"] for r in good if r["heap_delta"] is not None]
            )
            if any(r["heap_delta"] is not None for r in good)
            else None,
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product-root", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--layout-dir", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument(
        "--campaign", choices=["all", "rq2", "rq4", "integrated"], default="all"
    )
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--current-source",
        action="store_true",
        help="Evaluate current local source, recording full hashes instead of requiring the old PR commit",
    )
    parser.add_argument("--rq4-warmups", type=int, default=1)
    parser.add_argument("--browser-executable", type=Path)

    args = parser.parse_args()
    if args.rq4_warmups not in (0, 1):
        parser.error("rq4 warmups must be 0 or 1")
    product = args.product_root.resolve()
    global COMMIT, VERSION, DATASET
    current_provenance = None
    if args.current_source:
        from evaluation_runtime import provenance

        current_provenance = provenance(product)
        COMMIT = current_provenance["product_commit"]
    else:
        assert (
            subprocess.check_output(
                ["rtk", "proxy", "git", "rev-parse", "HEAD"], cwd=product, text=True
            ).strip()
            == COMMIT
        )
        assert not subprocess.check_output(
            ["rtk", "proxy", "git", "diff", "HEAD", "--", "code/client", "code/server"],
            cwd=product,
        )
    assert file_hash(args.dataset) == DATA_SHA
    sys.path.insert(0, str(product / "code/server/src"))
    from phylo_lens_server.http.graph.schemas import GraphViewportQuery
    from phylo_lens_server.repository.layout.sqlite_layout_repository import (
        PreparedLayoutStore,
    )
    from phylo_lens_server.services.graph_service import read_graph_viewport

    store = PreparedLayoutStore(args.layout_dir.resolve())
    if args.current_source:
        from phylo_lens_server.data.normalizer import (
            NormalizeRequest,
            normalize_dataset,
        )
        from phylo_lens_server.pipeline.ingest import layout_version_for_dataset

        normalized = normalize_dataset(
            NormalizeRequest(
                format="newick",
                dataset_name=args.dataset.stem,
                content=args.dataset.read_text(),
            )
        ).dataset
        DATASET = normalized.dataset_id
        VERSION = layout_version_for_dataset(normalized)
    with sqlite3.connect(store.path) as connection:
        if args.current_source:
            assert (
                connection.execute(
                    "select count(*) from node_positions where dataset_id=? and layout_version=?",
                    (DATASET, VERSION),
                ).fetchone()[0]
                == 100000
            )
        evidence = targets(connection)
        if args.current_source:
            clusters = connection.execute(
                "select cluster_id,lod_level,member_count,representative_node_id,x,y from prepared_clusters where dataset_id=? and layout_version=? and member_count>1 order by lod_level,cluster_id",
                (DATASET, VERSION),
            ).fetchall()

            def record(row, label):
                return dict(
                    zip(
                        (
                            "cluster_id",
                            "lod_level",
                            "member_count",
                            "attachment_node_id",
                            "x",
                            "y",
                        ),
                        row,
                    ),
                    scenario=label,
                )

            small = next(r for r in clusters if r[2] == 2)
            large = next(r for r in clusters if r[2] == 3796)
            midpoint = math.sqrt(small[2] * large[2])
            medium = min(
                clusters, key=lambda r: (abs(math.log(r[2] / midpoint)), r[1], r[0])
            )
            evidence["targets"] = [
                record(small, "small"),
                record(medium, "medium"),
                record(large, "large"),
            ]
            evidence["rule"] = (
                "small=2; large=3796; medium nearest logarithmic geometric midpoint; ties lowest LoD then ID"
            )

    directory = ROOT / "eval/results/local" / args.run_id
    directory.mkdir(exist_ok=False, parents=True)
    write(directory / "rq4-targets.json", evidence)
    for target in evidence["targets"]:
        print("TARGET", target, flush=True)
    conditions = condition_queries()
    for condition in conditions:
        response = read_graph_viewport(GraphViewportQuery(**condition["query"]), store)
        condition["expected"] = {
            "lod_level": response.lod_level,
            "nodes": len(response.nodes),
            "edges": len(response.edges),
            "aggregates": sum(n.member_count > 1 for n in response.nodes),
            "truncated": response.truncated,
        }
        print("INTEGRATED", condition, flush=True)
    write(directory / "integrated-conditions.json", conditions)
    for probe in (
        "/tmp/lod-probe.json",
        "/tmp/lod-probe-extra.json",
        "/tmp/lod-probe-wide.json",
    ):
        if Path(probe).exists():
            shutil.copy(probe, directory / Path(probe).name)
    scripts = [
        Path(__file__),
        ROOT / "scripts/local_eval_server.py",
        ROOT / "scripts/evaluation_runtime.py",
        ROOT / "scripts/run_local_rq34.py",
        ROOT / "eval/browser/src/page.ts",
        ROOT / "eval/browser/src/rq4-final-runner.mjs",
        ROOT / "eval/browser/src/final_runner.mjs",
        ROOT / "eval/browser/src/fixtures.mjs",
        ROOT / "eval/browser/src/replay.mjs",
    ]
    for path in scripts:
        shutil.copy(path, directory / path.name)
    manifest = {
        "protocol": "current-source-evidence-v2"
        if args.current_source
        else "final-local-pr39-evidence-v1",
        "rq4_warmups_per_condition": args.rq4_warmups if args.current_source else 0,
        "product_commit": COMMIT,
        "product_root": str(product),
        "dataset_sha256": DATA_SHA,
        "dataset_path": str(args.dataset.resolve()),
        "layout_version": VERSION,
        "prepared_database": str(store.path),
        "target_rule": evidence["rule"],
        "browser": {
            "headless": False,
            "viewport": {"width": 960, "height": 640},
            "device_scale_factor": 1,
            "locale": "en-US",
            "timezone": "UTC",
            "launch_args": [],
            "executable_path": str(args.browser_executable.resolve())
            if args.browser_executable
            else None,
        },
        "host": {
            key: subprocess.check_output(command, text=True).strip()
            for key, command in {
                "platform": ["uname", "-a"],
                "cpu": ["sysctl", "-n", "machdep.cpu.brand_string"],
                "memory_bytes": ["sysctl", "-n", "hw.memsize"],
            }.items()
        },
        "execution": "Headed Chromium, client and API on 127.0.0.1; no remote backend",
        "harness_sha256": {str(p.relative_to(ROOT)): file_hash(p) for p in scripts},
        "client_bundle_sha256": file_hash(product / "code/client/dist/index.js"),
        "campaign": args.campaign,
        "smoke": args.smoke,
        "command": sys.argv,
        "provenance_todo": {
            key: "TODO: not established by retained Newick file"
            for key in (
                "EnteroBase_scheme_version",
                "download_date",
                "original_profile_count",
                "locus_count",
            )
        },
    }
    if current_provenance:
        from evaluation_runtime import snapshot

        manifest.update(snapshot(product, directory / "product-source"))
    write(directory / "manifest.json", manifest)
    rows = []

    def observe(campaign, name, rep, control, runner):
        path = directory / campaign / name / ("warmup" if rep == 0 else f"{rep:03}")
        path.mkdir(parents=True)
        control.update(
            browser=manifest["browser"],
            browser_dist_path=str(ROOT / "eval/browser/dist"),
            screenshot_path=str(path / "after.png"),
            runtime_state_path=str(path / "runtime.json"),
            frame_samples_path=str(path / "frames.json"),
            replay_access_log_path=str(path / "replay.json"),
        )
        write(path / "control.json", control)
        print(campaign, name, rep, flush=True)
        with (path / "browser.log").open("w") as log:
            subprocess.run(
                [
                    "node",
                    str(ROOT / "eval/browser/src" / runner),
                    str(path / "control.json"),
                    str(path / "result.json"),
                ],
                cwd=ROOT,
                stdout=log,
                stderr=log,
                timeout=180,
                check=True,
            )
        raw = json.loads((path / "result.json").read_text())
        first = raw.get("first")
        viewport = [
            r for r in raw.get("request_trace", []) if r.get("responseMetadata")
        ]
        if campaign == "rq2-replay":
            timing = raw.get("timing", {})
            response = (
                raw.get("fixture", {})
                | {
                    "payload_bytes": next(
                        (
                            r["response_bytes"]
                            for r in json.loads((path / "replay.json").read_text())
                            if r["path"] == "/api/graph/viewport"
                        ),
                        None,
                    )
                }
                if raw["status"] == "success"
                else {}
            )
            heap = (
                raw.get("heap", {})
                .get("delta", {})
                .get("js_heap_used_bytes", {})
                .get("bytes")
            )
        elif first:
            timing = {
                "first_visualization_ms": first["t2"] - first["t0"],
                "load_resolve_ms": first["t1"] - first["t0"],
                "snapshot_application_ms": first["initial"]["timestamp"] - first["t0"],
                "post_load_frame_ms": first["t2"] - first["t1"],
            }
            response = viewport[0]["responseMetadata"] if viewport else {}
            heap = raw["heap"]["delta_bytes"]
        else:
            timing = phases(raw)
            heap = None
            relevant = raw.get("relevant_requests", [])
            response = relevant[-1].get("responseMetadata") if relevant else None
        valid = raw["status"] == "success" and bool(
            raw.get("gpu", {}).get("hardware_accelerated")
        )
        if campaign == "rq4":
            valid &= (
                bool(raw.get("input_event", {}).get("isTrusted"))
                and timing.get("interaction_display_ms") is not None
                and raw["input_event"]["timestamp"]
                <= raw.get("event", {}).get("timestamp", -1)
                <= raw.get("t_settled", -1)
                and raw["event"]["boundary"]["sequence"]
                > raw["pre_operation"]["boundary"]["sequence"]
            )
            if control.get("target"):
                valid &= (
                    raw.get("target", {}).get("clusterId")
                    == control["target"]["cluster_id"]
                )
                if control["operation"] == "cluster_expand":
                    valid &= bool(response and not response["truncated"])
        if campaign == "rq2-integrated":
            expected = control["expected"]
            valid &= all(
                response.get(key) == expected[value]
                for key, value in (
                    ("lod_level", "lod_level"),
                    ("node_count", "nodes"),
                    ("edge_count", "edges"),
                    ("aggregate_count", "aggregates"),
                )
            )
        row = {
            "campaign": campaign,
            "condition": name,
            "repetition": rep,
            "warmup": rep == 0,
            "valid": bool(valid),
            "status": raw["status"],
            "timing": timing,
            "response": response,
            "target": control.get("target"),
            "frame_intervals_ms": raw.get("frame_intervals_ms", []),
            "heap_delta": heap,
            "artifact": str(path / "result.json"),
        }
        rows.append(row)
        write(directory / "observations.json", rows)
        write(directory / "summary.json", summarize(rows))
        if not valid:
            raise RuntimeError(f"Invalid observation: {path}")

    if args.campaign in ("all", "rq2"):
        config = json.loads((ROOT / "eval/config/rq2-experiments.json").read_text())
        experiment = next(
            e for e in config["experiments"] if e["id"] == "rq2-client-final-v022"
        )
        write(directory / "rq2-replay-protocol.json", experiment)
        for fixture in experiment["fixtures"]:
            for rep in range(2 if args.smoke else 6):
                observe(
                    "rq2-replay",
                    fixture["id"],
                    rep,
                    {
                        "fixture": fixture,
                        "global_prepared_node_count": 100000,
                        "max_nodes": 100000,
                        "quiescence_ms": 100,
                        "local_replay_isolation": True,
                        "frame_stress": experiment["frame_stress"],
                    },
                    "final_runner.mjs",
                )
    if args.campaign in ("all", "rq4", "integrated"):
        port = free_port()
        env = {
            **os.environ,
            "PYTHONPATH": str(product / "code/server/src")
            + os.pathsep
            + str(ROOT / "scripts"),
            "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(store.path.parent),
            "PHYLO_LENS_PREPARE_JOB_BACKEND": "local",
            "PHYLO_LENS_CORS_ORIGINS": "*",
        }
        with (directory / "server.log").open("w") as log:
            server = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "local_eval_server:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                env=env,
                cwd=product,
                stdout=log,
                stderr=log,
            )
            try:
                for _ in range(150):
                    try:
                        urllib.request.urlopen(
                            f"http://127.0.0.1:{port}/health", timeout=1
                        ).close()
                        break
                    except OSError:
                        time.sleep(0.2)
                prepared = {
                    "dataset_id": DATASET,
                    "layout_version": VERSION,
                    "node_count": 100000,
                    "edge_count": 99999,
                    "cluster_count": sum(
                        condition["representations"]
                        for condition in json.loads(
                            (args.layout_dir.parent / "rq3.json").read_text()
                        )
                    )
                    if args.current_source
                    else 207923,
                    "lod_tier_count": len(
                        json.loads((args.layout_dir.parent / "rq3.json").read_text())
                    )
                    if args.current_source
                    else 15,
                    "layout_status": "ready",
                    "warnings": [],
                }
                common = {
                    "local_development": True,
                    "api_url": f"http://127.0.0.1:{port}",
                    "web_port": free_port(),
                    "content": args.dataset.read_text(),
                    "name": DATASET,
                    "prepared_result": prepared,
                    "setup_quiescence_ms": 2000,
                    "baseline_frame_sample_count": 12,
                    "timeout_ms": 60000,
                }
                if args.campaign in ("all", "integrated"):
                    for condition in conditions:
                        for rep in range(2 if args.smoke else 6):
                            observe(
                                "rq2-integrated",
                                condition["condition"],
                                rep,
                                common
                                | {
                                    "integrated_rq2": True,
                                    "initial_query": condition["query"],
                                    "expected": condition["expected"],
                                },
                                "rq4-final-runner.mjs",
                            )
                if args.campaign in ("all", "rq4"):
                    scenarios = [("navigation", "viewport_navigation", None)]
                    for target in evidence["targets"]:
                        scenarios += [
                            (f"{op}-{target['scenario']}", f"cluster_{op}", target)
                            for op in ("expand", "collapse")
                        ]
                    for name, op, target in scenarios:
                        for rep in range(
                            0 if args.current_source and args.rq4_warmups else 1,
                            2 if args.smoke else 8,
                        ):
                            extra = {}
                            if target:
                                extra = {
                                    "target": target
                                    | {
                                        "represented_member_count": target[
                                            "member_count"
                                        ],
                                        "controlled_setup": True,
                                    },
                                    "initial_query": {
                                        "dataset_id": DATASET,
                                        "layout_version": VERSION,
                                        "lod_level": target["lod_level"],
                                        "xmin": target["x"] - 0.04,
                                        "xmax": target["x"] + 0.04,
                                        "ymin": target["y"] - 0.04,
                                        "ymax": target["y"] + 0.04,
                                    },
                                }
                            observe(
                                "rq4",
                                name,
                                rep,
                                common
                                | {
                                    "operation": op,
                                    "input": {"client_x": 20, "client_y": 20},
                                }
                                | extra,
                                "rq4-final-runner.mjs",
                            )
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
    write(
        directory / "audit.json",
        {
            "valid": all(r["valid"] for r in rows),
            "observations": len(rows),
            "measured": sum(not r["warmup"] for r in rows),
            "targets_distinct": True,
            "product_commit": COMMIT,
        },
    )
    if args.current_source:
        from evaluation_runtime import source_hashes

        assert source_hashes(product) == manifest["product_source_sha256"], (
            "Product changed during the campaign"
        )
    print("COMPLETED", directory, flush=True)


if __name__ == "__main__":
    main()
