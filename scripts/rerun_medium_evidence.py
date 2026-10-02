"""Replace only medium RQ4 observations in a derived, provenance-linked final run."""

import argparse
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from run_final_local_evidence import COMMIT, phases, summarize
from run_local_rq34 import ROOT, file_hash, free_port, write

REPLACED = {"expand-medium", "collapse-medium"}
RULE = (
    "Small and large remain the previously measured targets. Medium minimizes "
    "abs(log(member_count/sqrt(small_count*large_count))) over all non-singleton "
    "clusters in this prepared dataset/layout; ties by lowest LoD level then cluster ID."
)


def select_medium(rows, small_count, large_count):
    midpoint = math.sqrt(small_count * large_count)
    row = min(rows, key=lambda r: (abs(math.log(r[2] / midpoint)), r[1], r[0]))
    return dict(
        zip(
            ("cluster_id", "lod_level", "member_count", "attachment_node_id", "x", "y"),
            row,
        )
    ) | {
        "scenario": "medium",
        "geometric_midpoint": midpoint,
        "log_distance": abs(math.log(row[2] / midpoint)),
    }


def tree_hashes(directory):
    return {
        str(path.relative_to(directory)): file_hash(path)
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous-run", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    previous = args.previous_run.resolve()
    before_hashes = tree_hashes(previous)
    manifest = json.loads((previous / "manifest.json").read_text())
    original_rows = json.loads((previous / "observations.json").read_text())
    evidence = json.loads((previous / "rq4-targets.json").read_text())
    small = next(t for t in evidence["targets"] if t["scenario"] == "small")
    large = next(t for t in evidence["targets"] if t["scenario"] == "large")
    old_medium = next(t for t in evidence["targets"] if t["scenario"] == "medium")
    with sqlite3.connect(manifest["prepared_database"]) as connection:
        clusters = connection.execute(
            "select cluster_id,lod_level,member_count,representative_node_id,x,y "
            "from prepared_clusters where dataset_id=? and layout_version=? and member_count>1",
            ("tree_fullmst_100000", manifest["layout_version"]),
        ).fetchall()
    target = select_medium(clusters, small["member_count"], large["member_count"])
    print("SELECTED MEDIUM", json.dumps(target), flush=True)
    assert target["member_count"] not in {small["member_count"], large["member_count"]}
    assert target["cluster_id"] not in {small["cluster_id"], large["cluster_id"]}
    product = Path(manifest["product_root"])
    assert (
        subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=product, text=True
        ).strip()
        == COMMIT
    )
    assert not subprocess.check_output(
        ["git", "diff", "HEAD", "--", "code/client", "code/server"], cwd=product
    )
    for path, digest in manifest["harness_sha256"].items():
        assert file_hash(ROOT / path) == digest, f"Measurement harness changed: {path}"
    for path, digest in manifest["evaluation_bundle_sha256"].items():
        relative = Path(path).relative_to("eval/browser/dist")
        assert file_hash(previous / "browser-dist" / relative) == digest
    directory = ROOT / "eval/results/local" / args.run_id
    directory.mkdir(parents=True, exist_ok=False)
    for name in ("integrated-conditions.json", "rq2-replay-protocol.json"):
        shutil.copy(previous / name, directory / name)
    evidence["previous_rule"] = evidence["rule"]
    evidence["rule"] = RULE
    evidence["targets"] = [small, target, large]
    write(directory / "rq4-targets.json", evidence)
    provenance = {
        "previous_run": str(previous),
        "previous_run_file_sha256": before_hashes,
        "replaced_scenarios": sorted(REPLACED),
        "previous_medium": old_medium,
        "new_medium": target,
        "selection_rule": RULE,
        "new_measurements": 14,
        "reused_observations": len(original_rows) - 14,
        "command": sys.argv,
        "rerun_script_sha256": file_hash(Path(__file__)),
    }
    write(directory / "medium-rerun.json", provenance)
    shutil.copy(Path(__file__), directory / "medium-rerun-harness-snapshot.py")
    manifest["medium_rerun"] = provenance
    manifest["command"] = sys.argv
    manifest["target_rule"] = RULE
    manifest["quantile_operational_definition"] = (
        "Small/large retained; medium now uses the recorded logarithmic midpoint rule."
    )
    write(directory / "manifest.json", manifest)
    retained = [row for row in original_rows if row["condition"] not in REPLACED]
    assert len(retained) == 101
    rows = []
    port, web_port = free_port(), free_port()
    env = {
        **os.environ,
        "PYTHONPATH": str(product / "code/server/src")
        + os.pathsep
        + str(ROOT / "scripts"),
        "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(
            Path(manifest["prepared_database"]).parent
        ),
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
                    if server.poll() is not None:
                        raise RuntimeError("Server exited; see server.log")
                    time.sleep(0.2)
            else:
                raise TimeoutError("Server readiness timeout")
            for scenario in ("expand-medium", "collapse-medium"):
                reference = next(r for r in original_rows if r["condition"] == scenario)
                template = json.loads(
                    Path(reference["artifact"]).with_name("control.json").read_text()
                )
                for repetition in range(1, 8):
                    path = directory / "rq4" / scenario / f"{repetition:03}"
                    path.mkdir(parents=True)
                    control = template | {
                        "api_url": f"http://127.0.0.1:{port}",
                        "web_port": web_port,
                        "browser_dist_path": str(previous / "browser-dist"),
                        "target": target
                        | {
                            "represented_member_count": target["member_count"],
                            "controlled_setup": True,
                        },
                        "initial_query": template["initial_query"]
                        | {
                            "lod_level": target["lod_level"],
                            "xmin": target["x"] - 0.04,
                            "xmax": target["x"] + 0.04,
                            "ymin": target["y"] - 0.04,
                            "ymax": target["y"] + 0.04,
                        },
                        "screenshot_path": str(path / "after.png"),
                        "runtime_state_path": str(path / "runtime.json"),
                        "frame_samples_path": str(path / "frames.json"),
                        "replay_access_log_path": str(path / "replay.json"),
                    }
                    write(path / "control.json", control)
                    print(scenario, repetition, "/ 7", flush=True)
                    with (path / "browser.log").open("w") as browser_log:
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
                            timeout=180,
                            check=True,
                        )
                    raw = json.loads((path / "result.json").read_text())
                    timing = phases(raw)
                    relevant = raw.get("relevant_requests", [])
                    response = (
                        relevant[-1].get("responseMetadata") if relevant else None
                    )
                    valid = raw["status"] == "success" and raw.get(
                        "input_event", {}
                    ).get("isTrusted")
                    valid = (
                        valid
                        and raw["gpu"]["hardware_accelerated"]
                        and timing["interaction_display_ms"] is not None
                    )
                    valid = valid and raw["target"]["clusterId"] == target["cluster_id"]
                    if scenario == "expand-medium":
                        valid = (
                            valid
                            and response
                            and not response["truncated"]
                            and response["total_node_count"] == target["member_count"]
                        )
                    row = {
                        "campaign": "rq4",
                        "condition": scenario,
                        "repetition": repetition,
                        "warmup": False,
                        "valid": bool(valid),
                        "status": raw["status"],
                        "timing": timing,
                        "response": response,
                        "target": control["target"],
                        "heap_delta": None,
                        "frame_intervals_ms": raw.get("frame_intervals_ms", []),
                        "artifact": str(path / "result.json"),
                    }
                    rows.append(row)
                    write(directory / "medium-observations.json", rows)
                    if not valid:
                        raise RuntimeError(f"Invalid observation: {path}")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    combined = retained + rows
    write(directory / "observations.json", combined)
    write(directory / "summary.json", summarize(combined))
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts/audit_final_local_evidence.py"),
            str(directory),
        ],
        check=True,
    )
    report = (directory / "REPORT.md").read_text()
    report = report.replace(
        "# Final local RQ2 and RQ4 evidence\n",
        "# Final local RQ2 and RQ4 evidence\n\n"
        f"**Medium-only rerun:** 14 new observations replace the previous four-member medium case with `{target['cluster_id']}` "
        f"(level {target['lod_level']}, {target['member_count']} members). The other 101 observations, including RQ2 warm-ups, "
        f"are reused unchanged from `{previous.name}`. The previous raw run remains intact. See medium-rerun.json for source hashes and lineage.\n",
    )
    report = report.replace(
        "Small and medium targets are deliberately close to the very small median of the prepared cluster records; one target per class "
        "does not establish a general latency-versus-size curve, and level/local context differs for the large target.",
        "The medium target is closest on a logarithmic scale to the geometric midpoint between the retained small and large counts. "
        "One target per class does not establish a general latency-versus-size curve; LoD level and local context also differ between classes.",
    )
    (directory / "REPORT.md").write_text(report)
    assert tree_hashes(previous) == before_hashes, "Previous raw run changed"
    assert [r for r in combined if r["condition"] not in REPLACED] == retained
    audit = json.loads((directory / "audit.json").read_text())
    audit["medium_rerun"] = {
        "new_observations": 14,
        "retained_observations": 101,
        "previous_run_unchanged": True,
        "unrelated_observations_unchanged": True,
        "selection_is_global_logarithmic_minimum": target
        == select_medium(clusters, small["member_count"], large["member_count"]),
    }
    write(directory / "audit.json", audit)
    write(
        directory / "rerun-summary.json",
        {
            key: json.loads((directory / "summary.json").read_text())[key]
            for key in sorted(REPLACED)
        },
    )
    print("MEDIUM RERUN AND COMBINED AUDIT PASS", directory, flush=True)


if __name__ == "__main__":
    main()
