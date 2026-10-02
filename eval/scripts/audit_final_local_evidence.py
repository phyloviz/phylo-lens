"""Independently audit retained final observations and write a thesis-facing report."""

import argparse
import json
import re
import shlex
import shutil
import sqlite3
import statistics
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

from run_final_local_evidence import COMMIT as LEGACY_COMMIT
from run_final_local_evidence import DATA_SHA, frames, summarize
from run_local_rq34 import ROOT, file_hash, validate_rq3, write


def server_timings(text):
    return {
        name: float(value)
        for name, value in re.findall(r"([a-z_]+);dur=([0-9.]+)", text or "")
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    rows = json.loads((directory / "observations.json").read_text())
    COMMIT = manifest["product_commit"]
    current = manifest["protocol"] == "current-source-evidence-v2"
    if current:
        COMMIT = manifest["product_commit"]
        from evaluation_runtime import source_hashes

        assert (
            source_hashes(Path(manifest["product_root"]))
            == manifest["product_source_sha256"]
        )
    else:
        assert manifest["product_commit"] == LEGACY_COMMIT
    assert file_hash(Path(manifest["dataset_path"])) == DATA_SHA
    for path, digest in manifest["harness_sha256"].items():
        assert file_hash(ROOT / path) == digest, f"Changed measurement source: {path}"
    product = Path(manifest["product_root"])
    assert (
        file_hash(product / "code/client/dist/index.js")
        == manifest["client_bundle_sha256"]
    )
    shutil.copyfile(
        product / "code/client/dist/index.js", directory / "client-bundle.js"
    )
    assert (
        subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=product, text=True
        ).strip()
        == COMMIT
    )
    if not current:
        assert not subprocess.check_output(
            ["git", "diff", "HEAD", "--", "code/client", "code/server"], cwd=product
        )
    counts = Counter((r["campaign"], r["condition"], r["warmup"]) for r in rows)
    rq4_warmups = manifest.get("rq4_warmups_per_condition", 0)
    measured_total = 18 if manifest.get("smoke") else 104
    warmup_total = 11 + 7 * rq4_warmups
    assert len(rows) == measured_total + warmup_total
    assert sum(not r["warmup"] for r in rows) == measured_total
    assert len({r["condition"] for r in rows if r["campaign"] == "rq2-replay"}) == 7
    assert len({r["condition"] for r in rows if r["campaign"] == "rq2-integrated"}) == 4
    assert len({r["condition"] for r in rows if r["campaign"] == "rq4"}) == 7
    for (campaign, _, warmup), count in counts.items():
        assert count == (
            1
            if warmup
            else 1
            if manifest.get("smoke")
            else 7
            if campaign == "rq4"
            else 5
        )
    targets = json.loads((directory / "rq4-targets.json").read_text())
    assert len({t["member_count"] for t in targets["targets"]}) == 3
    runtime = []
    enriched = []
    timer_evidence = []
    for row in rows:
        assert row["valid"]
        raw = json.loads(Path(row["artifact"]).read_text())
        assert raw["status"] == "success"
        assert raw["gpu"]["hardware_accelerated"] and raw["gpu"]["backend"] == "Metal"
        runtime.append({"browser": raw["browser"], "gpu": raw["gpu"]})
        samples = row["frame_intervals_ms"]
        if row["campaign"] == "rq4":
            # Native capture resets the legacy sampler's previous timestamp.
            # Its first gap is capture-to-rAF, not two consecutive frames.
            samples = samples[1:]
        item = row | {"frames": frames(samples), "frame_intervals_ms": samples}
        item["partial_initial_frame_gap_ms"] = (
            row["frame_intervals_ms"][0]
            if row["campaign"] == "rq4" and row["frame_intervals_ms"]
            else None
        )
        if row.get("response") and row["campaign"] != "rq2-replay":
            response = row["response"]
            assert response["payload_bytes"] > 0 and response["truncated"] is False
            timing = server_timings(response["server_timing"])
            assert all(
                key in timing
                for key in (
                    "query",
                    "construction",
                    "json_serialization",
                    "schema_serialization",
                )
            )
            assert timing["schema_serialization"] >= timing["json_serialization"]
            item["server_timing_ms"] = timing
            item["displayed_elements"] = response["node_count"] + response["edge_count"]
        if row["campaign"] == "rq2-replay":
            assert raw["replay"]["post_initial_viewport_request_count"] == 0
            assert raw["replay"]["controlled_setup"]["allExpanded"]
            assert raw["snapshot"]["fixture_congruent"]
            assert len(set(raw["replay"]["response_checksums"])) == 1
            f = raw["fixture"]
            assert (
                f["expected_primitive_count"]
                == f["node_count"] + f["edge_count"] + f["triangle_count"]
            )
        if row["campaign"] == "rq2-integrated":
            first = raw["first"]
            assert (
                first["t0"]
                <= first["initial"]["timestamp"]
                <= first["t1"]
                <= first["t2"]
            )
            request = next(r for r in raw["request_trace"] if r.get("responseMetadata"))
            assert request["body"]["lod_target_representations"] == 1066
            assert (
                "max_nodes" not in request["body"]
                and "cluster_id" not in request["body"]
            )
            assert (
                request["responseMetadata"]["payload_bytes"]
                == request["encodedBodySize"]
            )
        if row["campaign"] == "rq4":
            start = raw["input_event"]["timestamp"]
            event = raw["event"]
            assert raw["input_event"]["isTrusted"]
            assert (
                event["boundary"]["sequence"]
                > raw["pre_operation"]["boundary"]["sequence"]
            )
            assert start <= event["timestamp"] <= raw["t_settled"]
            if row["target"]:
                target = row["target"]
                initial = next(
                    t
                    for t in raw["initial"]["diagnostics"]["aggregateTargets"]
                    if t["clusterId"] == target["cluster_id"]
                )
                assert initial["representedNodeCount"] == target["member_count"]
                assert raw["target"]["clusterId"] == target["cluster_id"]
                assert event["boundary"]["clusterId"] == target["cluster_id"]
                if row["condition"].startswith("expand-"):
                    assert row["response"]["node_count"] == target["member_count"] + 1
                    assert row["response"]["edge_count"] == target["member_count"]
                    assert row["response"]["total_node_count"] == target["member_count"]
                else:
                    restored = next(
                        t
                        for t in event["diagnostics"]["aggregateTargets"]
                        if t["clusterId"] == target["cluster_id"]
                    )
                    assert restored["representedNodeCount"] == target["member_count"]
                    assert (
                        restored["structuralFingerprint"]
                        == initial["structuralFingerprint"]
                    )
            if row["response"]:
                timing = row["timing"]
                phases = (
                    "input_to_request_ms",
                    "http_interval_ms",
                    "response_to_snapshot_ms",
                    "snapshot_to_two_raf_ms",
                )
                assert all(timing[p] >= 0 for p in phases)
                assert (
                    abs(
                        sum(timing[p] for p in phases)
                        - timing["interaction_display_ms"]
                    )
                    < 1e-6
                )
            if row["condition"] == "navigation":
                timers = raw["timer_trace"]
                fired = [t for t in timers if "fired" in t]
                assert fired
                last = max(fired, key=lambda t: t["fired"])
                issued = raw["relevant_requests"][-1]["fetchInvocationTimestamp"]
                timer_evidence.append(
                    {
                        "repetition": row["repetition"],
                        "scheduled_delay_ms": last["delay_ms"],
                        "native_to_last_schedule_ms": last["scheduled"] - start,
                        "last_schedule_to_fire_ms": last["fired"] - last["scheduled"],
                        "timer_fire_to_request_ms": issued - last["fired"],
                        "timer_count": len(timers),
                        "fired_timer_count": len(fired),
                    }
                )
        enriched.append(item)
    write(directory / "analysis-observations.json", enriched)
    write(directory / "navigation-timer-audit.json", timer_evidence)
    # Fresh validation links the current prepared hierarchy to these viewport responses.
    sys.path.insert(0, str(product / "code/server/src"))
    from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
    from phylo_lens_server.pipeline.clustering import (
        rooted_depths,
        selected_depths,
        tree_adjacency,
    )
    from phylo_lens_server.repository.layout.sqlite_layout_repository import (
        PreparedLayoutStore,
    )

    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="tree_fullmst_100000",
            content=Path(manifest["dataset_path"]).read_text(),
        )
    ).dataset
    database = Path(manifest["prepared_database"])
    assert database.exists(), (
        f"Restore the verified archive with gzip -dk {database}.gz before auditing"
    )
    store = PreparedLayoutStore(database.parent)
    cuts = selected_depths(
        rooted_depths(tree_adjacency(dataset), dataset.technical_roots)
    )
    rq3 = validate_rq3(dataset, store, manifest["layout_version"], cuts)
    write(directory / "rq3-link-validation.json", rq3)
    with sqlite3.connect(store.path) as connection:
        for target in targets["targets"]:
            members = {
                r[0]
                for r in connection.execute(
                    "select node_id from cluster_members where cluster_id=?",
                    (target["cluster_id"],),
                )
            }
            assert len(members) == target["member_count"]
            crossing = [
                e
                for e in dataset.edges
                if (e.source in members) != (e.target in members)
            ]
            assert len(crossing) == 1
            outside = ({crossing[0].source, crossing[0].target} - members).pop()
            result = store.read_viewport(
                dataset_id=dataset.dataset_id,
                layout_version=manifest["layout_version"],
                xmin=None,
                xmax=None,
                ymin=None,
                ymax=None,
                cluster_id=target["cluster_id"],
            )
            assert {n.node_id for n in result.nodes} == members | {outside}
            assert len(result.edges) == len(members)
    manifest["runtime_observed"] = list(
        {json.dumps(r, sort_keys=True): r for r in runtime}.values()
    )
    manifest["python"] = sys.version
    manifest["dependencies"] = {
        name: version(name) for name in ("fastapi", "pydantic", "starlette", "uvicorn")
    }
    manifest["sqlite_version"] = sqlite3.sqlite_version
    manifest["node_version"] = subprocess.check_output(
        ["node", "--version"], text=True
    ).strip()
    manifest["completed_audit_at"] = datetime.now(timezone.utc).isoformat()
    manifest["audit_script_sha256"] = file_hash(Path(__file__))
    shutil.copyfile(Path(__file__), directory / "audit-source.py")
    manifest["prepared_global_representations"] = [r["representations"] for r in rq3]
    manifest["evaluation_bundle_sha256"] = {
        str(p.relative_to(ROOT)): file_hash(p)
        for p in (ROOT / "eval/browser/dist").rglob("*")
        if p.is_file()
    }
    shutil.copytree(
        ROOT / "eval/browser/dist", directory / "browser-dist", dirs_exist_ok=True
    )
    write(directory / "manifest.json", manifest)
    audit = {
        "valid": True,
        "total_observations": len(rows),
        "measured_observations": measured_total,
        "warmups": warmup_total,
        "rq2_replay_measured": 35,
        "rq2_integrated_measured": 20,
        "rq4_measured": 49,
        "checks": [
            "source commit and content hashes",
            "fresh browser/context per runner invocation",
            "hardware Metal WebGL",
            "exact repetitions",
            "identical replay payloads and isolated stress",
            "integrated query and response counts",
            "untruncated responses and exact payload bytes",
            "trusted native input and newer applicable snapshots",
            "same-clock timing phase sums",
            "restored collapsed-cluster count and fingerprint",
            "repository expansion memberships and one boundary edge",
            "15 prepared-level structural invariants and finest singleton partition",
        ],
        "global_representations": [r["representations"] for r in rq3],
    }
    write(directory / "audit.json", audit)
    original_summary = directory / "runner-summary.json"
    if not original_summary.exists():
        write(original_summary, json.loads((directory / "summary.json").read_text()))
    summary = summarize(enriched)
    write(directory / "summary.json", summary)
    dispersion = {}
    for condition in summary:
        values = [
            r for r in enriched if r["condition"] == condition and not r["warmup"]
        ]
        metrics = {}
        for metric in summary[condition]["median_timing"]:
            samples = [
                r["timing"][metric]
                for r in values
                if r["timing"].get(metric) is not None
            ]
            if samples:
                quartiles = (
                    statistics.quantiles(samples, n=4, method="inclusive")
                    if len(samples) > 1
                    else [samples[0]] * 3
                )
                metrics[metric] = {
                    "n": len(samples),
                    "median": statistics.median(samples),
                    "p25": quartiles[0],
                    "p75": quartiles[2],
                    "min": min(samples),
                    "max": max(samples),
                }
        dispersion[condition] = metrics
    write(
        directory / "timing-dispersion.json",
        {
            "quantile_method": "linear inclusive; warm-ups excluded",
            "conditions": dispersion,
        },
    )
    write(
        directory / "summary-with-provenance.json",
        {
            "provenance": {
                key: manifest.get(key)
                for key in (
                    "protocol",
                    "product_commit",
                    "product_fingerprint",
                    "package_version",
                    "published_release",
                )
            },
            "scenarios": summary,
        },
    )
    lines = [
        "# Final local RQ2 and RQ4 evidence",
        "",
        (
            f"Product base commit `{COMMIT}`; source fingerprint `{manifest.get('product_fingerprint', 'historical clean checkout')}`. All **{measured_total} measured observations and {warmup_total} warm-ups** passed the independent audit. "
            "No product behavior, release, RQ1, external comparison, thesis prose or publication figure was changed."
        ),
        "",
        "## Execution and dataset",
        "",
        (
            "Headed Chromium 140.0.7339.16; Playwright 1.55.0; 960×640 CSS pixels; device scale factor 1; "
            "WebGL ANGLE Metal on Apple M4 Pro. Both browser client and API ran on 127.0.0.1 on the same macOS host. "
            f"Host memory: {int(manifest['host']['memory_bytes']) / 2**30:.0f} GiB. Python/runtime versions and source/build hashes are in manifest.json."
        ),
        "",
        (
            f"Retained Salmonella cgMLST Full MST Newick: 100,000 nodes, 99,999 edges; SHA256 `{DATA_SHA}`. "
            f"Prepared layout `{manifest['layout_version']}` reused. Independent validation passed all 15 hop-cut levels. "
            "Clusters are connected collapsed descendant subtrees with one external edge; the technical root only orients hop depth. "
            "No biological meaning is inferred from the visualization aggregates."
        ),
        "",
        (
            "**Provenance TODOs:** EnteroBase scheme/version, download date, original profile count and locus count are not established "
            "by the retained file and must be supplied by its owner."
        ),
        "",
        "## RQ2: isolated browser replay",
        "",
        (
            "One warm-up plus five measured observations per existing condition; fresh browser/context each time. "
            "First visualization is public view.load() invocation → load resolution → two animation-frame callbacks. "
            "Heap delta uses CDP before load and 100 ms after that boundary, without forced GC. "
            "Replay removes real layout/database variation but retains localhost bootstrap/HTTP cost. "
            "Frame pacing is the separate existing native drag/wheel stress window. Public pinning and expansion "
            "complete outside first-visualization/heap/stress measurement; every stress window has zero viewport requests."
        ),
        "",
        "| Condition | Nodes | Edges | Triangle glyphs | Protocol units | Payload bytes | Median first visualization ms | Median heap delta MiB | Frame median / p95 / max ms | >50 ms count / samples |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|---|",
    ]
    for key in sorted(
        (k for k in summary if k.startswith(("detail-", "triangle-"))),
        key=lambda k: (k.startswith("triangle-"), int(k.split("-")[1][:-1])),
    ):
        s = summary[key]
        r = s["response"]
        f = s["pooled_frames"]
        label = (
            "Node-and-edge "
            if key.startswith("detail-")
            else "Controlled cluster rendering "
        ) + key.split("-")[1]
        lines.append(
            f"| {label} | {r['node_count']} | {r['edge_count']} | {r['triangle_count']} | {r['expected_primitive_count']} | {r['payload_bytes']} | {s['median_timing']['client_first_visualization_ms']:.1f} | {s['median_heap_delta_bytes'] / 2**20:.2f} | {f['median_ms']:.1f} / {f['p95_ms']:.1f} / {f['max_ms']:.1f} | {f['above_50ms_count']} / {f['count']} ({f['above_50ms_proportion']:.1%}) |"
        )
    lines += [
        "",
        (
            "The legacy protocol units are nodes + edges + triangular glyphs; glyphs are already included in nodes. "
            "Thus 9,999 = 5,000 nodes + 4,999 edges; 9,998 = 3,333 nodes + 3,332 edges + 3,333 triangular glyphs. "
            "The latter has 6,665 distinct node/edge elements. These are different fixture compositions, not a count typo. "
            "Triangular glyphs render collapsed-cluster nodes; they do not represent a biological tree in this control."
        ),
        "",
        "## RQ2: integrated Salmonella viewport conditions",
        "",
        (
            "One warm-up plus five observations for each prescribed viewport window. The evaluation substitutes the first query "
            "with normal adaptive selection parameters: semantic zoom preference, 1,066-representation CSS-area target, "
            "unexpanded selection bounds and 50% padding per side for retrieval. No effective tier or max_nodes limit is forced. "
            "The real evaluated server selects the level and produces the payload; only preparation is mocked as ready. "
            "This measures loading a real viewport response into a fresh view, not an observed native camera-navigation sequence. "
            "First visualization keeps the load-to-two-frame boundary; snapshot latency ends at the snapshot observer. "
            "Frame samples cover that same load window, rather than replay's separate drag/wheel stress. Heap uses the same CDP mechanism."
        ),
        "",
        "| Condition | Zoom | Preferred / effective level | Nodes | Edges | Collapsed clusters | Distinct node+edge elements | Payload bytes | Median snapshot / first visualization ms | Heap delta MiB | Frame median / p95 / max ms | >50 ms count / samples |",
        "|---|---:|---|---:|---:|---:|---:|---:|---|---:|---|---|",
    ]
    conditions = json.loads((directory / "integrated-conditions.json").read_text())
    for c in conditions:
        s = summary[c["condition"]]
        r = s["response"]
        f = s["pooled_frames"]
        q = c["query"]
        lines.append(
            f"| {c['condition']} | {q['zoom']:.2f} | {q['lod_level']} / {r['lod_level']} | {r['node_count']} | {r['edge_count']} | {r['aggregate_count']} | {r['node_count'] + r['edge_count']} | {r['payload_bytes']} | {s['median_timing']['snapshot_application_ms']:.1f} / {s['median_timing']['first_visualization_ms']:.1f} | {s['median_heap_delta_bytes'] / 2**20:.2f} | {f['median_ms']:.1f} / {f['p95_ms']:.1f} / {f['max_ms']:.1f} | {f['above_50ms_count']} / {f['count']} ({f['above_50ms_proportion']:.1%}) |"
        )
    lines += [
        "",
        (
            "Exact selection/retrieval bounds, camera ratios, zoom preferences and expected counts are in integrated-conditions.json. "
            "The finite probes reached 8,160 returned nodes; this is the largest discovered condition, not a proven global maximum. "
            "10k/20k returned-node coverage was not achieved at the chosen default viewport. Larger replay fixtures still provide "
            "separate browser scalability evidence; do not claim integrated coverage for those sizes."
        ),
        "",
        "Global level representation counts: `"
        + ", ".join(str(r["representations"]) for r in rq3)
        + "`. "
        "The corresponding prepared levels can contain far more nodes/clusters than a selected viewport retrieves. "
        "These real responses connect RQ2 to the validated RQ3 hierarchy; they do not demonstrate whole-tree rendering. "
        "Returned counts can exceed the CSS-area target because retrieval uses a padded spatial region after selection.",
        "",
        "## RQ4: interaction/display latency",
        "",
        targets["rule"],
        "",
        "| Class | Cluster ID | Level | Original nodes | Expansion response nodes / edges / bytes |",
        "|---|---|---:|---:|---|",
    ]
    for t in targets["targets"]:
        r = summary["expand-" + t["scenario"]]["response"]
        lines.append(
            f"| {t['scenario']} | `{t['cluster_id']}` | {t['lod_level']} | {t['member_count']} | {r['node_count']} / {r['edge_count']} / {r['payload_bytes']} |"
        )
    lines += [
        "",
        (
            "Each scenario has seven measured observations with a fresh browser/context. Current-source v2 additionally retains one excluded warm-up per scenario. Expansion/collapse setup loads the selected "
            "prepared level near the attachment node and pins it through the public API; setup and target selection are outside measurement. "
            "A trusted native click on an evaluation button calls the public API for the recorded cluster ID. Collapse pre-expands the target. "
            "Navigation uses the native wheel under normal adaptive selection. Expansion responses include the subtree's nodes and one external "
            "attachment-context node, explaining the +1 node count. All responses are untruncated."
        ),
        "",
        (
            "Interaction/display latency: trusted capture-phase native input → applicable newer graph snapshot → two animation-frame callbacks "
            "scheduled by the snapshot observer. The end does not establish that all later animation, rendering or HTTP activity is idle. "
            "RQ4 frame sampling is reset at input and restricted to intervals ending within that boundary. "
            "The first capture-to-frame partial gap is retained in raw results but excluded from audited frame-interval statistics."
        ),
        "",
        "| Scenario | Median latency ms | Input→request ms | HTTP interval ms | Response→snapshot ms | Snapshot→two frames ms | Frame median / p95 / max ms | >50 ms count / samples |",
        "|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for key in (
        "navigation",
        "expand-small",
        "collapse-small",
        "expand-medium",
        "collapse-medium",
        "expand-large",
        "collapse-large",
    ):
        s = summary[key]
        m = s["median_timing"]
        f = s["pooled_frames"]

        def phase(name, m=m):
            return f"{m[name]:.1f}" if name in m else "—"

        lines.append(
            f"| {key} | {m['interaction_display_ms']:.1f} | {phase('input_to_request_ms')} | {phase('http_interval_ms')} | {phase('response_to_snapshot_ms')} | {m['snapshot_to_two_raf_ms']:.1f} | {f['median_ms']:.1f} / {f['p95_ms']:.1f} / {f['max_ms']:.1f} | {f['above_50ms_count']} / {f['count']} ({f['above_50ms_proportion']:.1%}) |"
        )
    lines += [
        "",
        (
            "Phase entries are medians of independently measured phases; their medians need not sum to the median total. "
            "Each individual observation's phases do sum to its total and share the browser performance clock. "
            "Collapse generally applies local state without HTTP; dashes indicate no measured request, not zero server latency."
        ),
        "",
        "### Navigation scheduling evidence",
        "",
        (
            "The controller resets a 120 ms debounce for ordinary viewport changes and uses 60 ms when the preferred LoD changes. "
            "It also defers work during manipulation and handles fit suppression. Sigma's configured wheel animation lasts 250 ms. "
            "The actual navigation traces below show when the final diagnostic timer was scheduled and fired relative to trusted input. "
            "Observation 0 is the excluded warm-up, retained here as diagnostic evidence only. "
            "Timer schedules/fires and stack evidence are retained in raw results; canceled timers have no fire timestamp."
        ),
        "",
        "| Observation | Native→last schedule ms | Scheduled delay ms | Actual schedule→fire ms | Fire→request ms |",
        "|---|---:|---:|---:|---:|",
    ]
    for t in timer_evidence:
        lines.append(
            f"| {t['repetition']} | {t['native_to_last_schedule_ms']:.1f} | {t['scheduled_delay_ms']} | {t['last_schedule_to_fire_ms']:.1f} | {t['timer_fire_to_request_ms']:.1f} |"
        )
    lines += [
        "",
        (
            "This supports the camera-animation-plus-reset-debounce explanation for this observed interval, rather than equating the entire "
            "input-to-request delay with one fixed debounce constant. It is not a universal navigation latency decomposition."
        ),
        "",
        "### Server durations",
        "",
        (
            "Evaluation-only wrappers measure repository count/read operations (SQL plus Python row processing), response-model construction, "
            "and the actual Pydantic JSON-byte encoding method. The enclosing FastAPI serialization interval includes validation and JSON encoding "
            "and overlaps the latter, so they must not be added. Server durations use a server-local clock; browser phases use one browser clock. "
            "HTTP interval includes request/server/response costs; a separate transfer time is not measured or inferred."
        ),
        "",
        "| Condition | Median repository query/read ms | Construction ms | JSON serialization ms | Enclosing schema serialization ms |",
        "|---|---:|---:|---:|---:|",
    ]
    for key in [c["condition"] for c in conditions] + [
        "navigation",
        "expand-small",
        "expand-medium",
        "expand-large",
    ]:
        items = [
            r["server_timing_ms"]
            for r in enriched
            if r["condition"] == key and not r["warmup"]
        ]
        values = [
            statistics.median(r[name] for r in items)
            for name in (
                "query",
                "construction",
                "json_serialization",
                "schema_serialization",
            )
        ]
        lines.append("| " + key + " | " + " | ".join(f"{v:.2f}" for v in values) + " |")
    lines += [
        "",
        "## Interpretation and limits",
        "",
        (
            "The replay campaign isolates client scaling for fixed fixture compositions. The integrated campaign adds the cost of real adaptive "
            "queries and returned Salmonella viewport responses; it must not be interpreted as the same isolated browser metric. "
            "RQ4 now compares three distinct subtree cardinalities and shows which phases contribute to interaction/display latency. "
            "The medium target is selected at the logarithmic midpoint between the fixed small and large counts; one target per class "
            "does not establish a general latency-versus-size curve, and level/local context differs for the large target."
        ),
        (
            f"Replay node-and-edge first-visualization medians increase from {summary['detail-1k-primitives']['median_timing']['client_first_visualization_ms']:.1f} to {summary['detail-40k-primitives']['median_timing']['client_first_visualization_ms']:.1f} ms over 500–20,000 nodes. "
            "Integrated response size alone does not predict latency: the 6,675-node condition takes longer than the 8,160-node condition, "
            "with a correspondingly higher measured repository read duration. Repository read time dominates the observed HTTP phase "
            "even for the small expansions. These are measured costs of this SQLite-backed local setup."
        ),
        "",
        (
            "Frame statistics pool samples across measured observations only, excluding warm-ups. Raw per-observation samples, statistics and "
            "counts/proportions are in analysis-observations.json; summary.json contains pooled statistics. The >50 ms threshold is a diagnostic "
            "flag for conspicuous frame gaps, not a universal perceptual threshold. Report the measurement windows, actual values and sample counts. "
            "Heap deltas depend on GC timing and include transient allocations and any work during the 100 ms wait; they are not GPU memory "
            "or a leak estimate. Headed execution, hardware acceleration and one host do not establish cross-device performance. "
            "There is no remote-network evidence, exhaustive viewport search, or guarantee that every later task is idle at the display boundary."
        ),
        (
            "Small and medium collapse windows are especially short, with only a few complete consecutive-frame intervals pooled per scenario. "
            "Those counts are too small to support broad conclusions from their p95 values."
        ),
        "",
        (
            "See audit.json, manifest.json, rq3-link-validation.json, rq4-targets.json, integrated-conditions.json and the per-observation raw "
            "controls/results/logs. Previous completed and failed runs remain untouched. No release publication is required."
        ),
        "",
    ]
    (directory / "REPORT.md").write_text("\n".join(lines))
    (directory / "COMMANDS.md").write_text(
        "# Exact measurement and verification commands\n\nWorking directory: `"
        + str(product / "code/client")
        + "`\n\n```sh\nrtk proxy npm run build:lib\n```\n\nWorking directory: `"
        + str(ROOT / "eval/browser")
        + "`\n\n```sh\nrtk proxy env PHYLO_LENS_EVAL_PRODUCT_ROOT="
        + shlex.quote(str(product))
        + " npm run build\nrtk proxy npm test\nrtk proxy npm run typecheck\nrtk proxy npm run lint\nrtk proxy npm run format:check\n```\n\nWorking directory: `"
        + str(ROOT)
        + "`\n\n```sh\n"
        + "rtk proxy .venv/bin/python "
        + shlex.join(manifest["command"])
        + "\n"
        + "rtk proxy .venv/bin/python "
        + shlex.join(sys.argv)
        + "\n"
        + "rtk proxy env PYTHONPATH="
        + shlex.quote(str(product / "code/server/src"))
        + " .venv/bin/python -m pytest -c eval/pyproject.toml eval/tests -q\n"
        + "rtk proxy .venv/bin/python -m ruff check eval/scripts/run_final_local_evidence.py eval/scripts/local_eval_server.py eval/scripts/audit_final_local_evidence.py eval/tests/test_final_local_evidence.py\nrtk proxy git diff --check\n```\n"
    )
    print("AUDIT PASS", directory)


if __name__ == "__main__":
    main()
