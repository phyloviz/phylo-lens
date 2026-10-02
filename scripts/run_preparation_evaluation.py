"""Current-source RQ1 and external comparison, without publishing a release.

One shared preparation server path; RQ1 is intended for the user's long run.
Every observation uses a fresh service/store. Heavy generated persistence is
removed after its size/hash and timing evidence are saved, unless requested.
"""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from statistics import median

import psutil
from evaluation_runtime import request, server, snapshot, source_hashes
from run_local_rq34 import ROOT, file_hash, free_port, write

COUNTS = [12500, 25000, 37500, 50000, 62500, 75000, 87500, 100000, 150000, 200000]


def summaries(rows):
    result = []
    for key in sorted({(r["tool"], r["nodes"]) for r in rows}):
        measured = [
            r for r in rows if (r["tool"], r["nodes"]) == key and not r["warmup"]
        ]
        good = [r for r in measured if r["status"] == "success"]
        result.append(
            {
                "tool": key[0],
                "nodes": key[1],
                "measured": len(measured),
                "success": len(good),
                "failures": len(measured) - len(good),
                "median_ms": median(r["elapsed_ms"] for r in good) if good else None,
            }
        )
    return result


class ProcessSampler:
    def __init__(self, pid, path):
        self.pid, self.path = pid, path
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.error = None

    def run(self):
        try:
            self.sample()
        except Exception as error:  # noqa: BLE001 -- propagate worker failures to the measurement caller
            self.error = error
            self.stop.set()

    def sample(self):
        root = psutil.Process(self.pid)
        with self.path.open("w") as f:
            while not self.stop.is_set():
                members = []
                try:
                    for p in [root, *root.children(recursive=True)]:
                        try:
                            cpu = p.cpu_times()
                            members.append(
                                {
                                    "pid": p.pid,
                                    "name": p.name(),
                                    "rss": p.memory_info().rss,
                                    "user_cpu_s": cpu.user,
                                    "system_cpu_s": cpu.system,
                                    "thread_count": p.num_threads(),
                                }
                            )
                        except psutil.Error:
                            pass
                except psutil.Error:
                    break
                f.write(
                    json.dumps(
                        {
                            "monotonic_s": time.monotonic(),
                            "rss_bytes": sum(m["rss"] for m in members),
                            "members": members,
                        }
                    )
                    + "\n"
                )
                self.stop.wait(0.02)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *unused):
        self.stop.set()
        self.thread.join()
        if self.error is not None and unused[0] is None:
            raise RuntimeError(
                f"Resource sampling failed: {self.error}"
            ) from self.error


def check_storage(nodes):
    # Conservative guard for transient SQLite/WAL/index files. It executes
    # outside measured windows and does not modify journal/checkpoint behavior.
    required = max(512 * 1024**2, int(3 * 1024**3 * nodes / 200000))
    free = shutil.disk_usage(ROOT).free
    if free < required:
        raise OSError(
            f"Insufficient free disk: {free / 1024**3:.2f} GiB; require {required / 1024**3:.2f} GiB for {nodes} nodes. No new observation started."
        )


def wrapper(thesis, tool, destination, product):
    original = thesis / "adapters/browser/wrappers" / tool
    shutil.copytree(
        original,
        destination,
        ignore=shutil.ignore_patterns("node_modules", "dist", ".vite"),
    )
    modules = destination / "node_modules"
    modules.mkdir()
    # Individual symlinks keep Vite's own cache/temp directories writable here,
    # rather than writing through a node_modules directory symlink into Thesis.
    for child in (original / "node_modules").iterdir():
        if not child.name.startswith("."):
            (modules / child.name).symlink_to(
                child.resolve(), target_is_directory=child.is_dir()
            )
    if tool == "phylolens":
        (destination / "vite.config.js").write_text(
            "export default "
            + json.dumps(
                {
                    "resolve": {
                        "alias": {
                            "@phyloviz/phylo-lens": str(
                                product / "code/client/dist/index.js"
                            )
                        }
                    }
                }
            )
            + ";\n"
        )
    if tool == "phylolens":
        source = destination / "src/main.js"
        text = source.read_text()
        text = text.replace("function check() {", "async function check() {")
        text = text.replace(
            "markReady();\n      try {",
            "markReady();\n      if (preparationReadyAtMs === null) { requestAnimationFrame(check); return; }\n      try {",
        )
        text = text.replace(
            "const visual = validateVisualOutput();",
            "const candidateFrame = performance.now();\n        const visual = await validateBitmapVisual(container, visibleSurface, invalidVisual);",
        )
        text = text.replace(
            "detected_at_ms: performance.now(), post_trigger_change: true",
            "detected_at_ms: candidateFrame, post_trigger_change: true",
        )
        text += (
            "\n" + (ROOT / "eval/browser/src/external-bitmap-validator.mjs").read_text()
        )
        source.write_text(text)
    return {
        str(p.relative_to(original)): file_hash(p)
        for p in original.rglob("*")
        if p.is_file() and "node_modules" not in p.parts and "dist" not in p.parts
    }


def run(args):
    check_storage(max(args.nodes))
    product = args.product_root.resolve()
    directory = ROOT / "eval/results/local" / args.run_id
    directory.mkdir(parents=True, exist_ok=False)
    state = snapshot(product, directory / "product-source")
    state.update(
        protocol="current-source-preparation-v2",
        campaign=args.campaign,
        warmups=1,
        measured_repetitions=1 if args.smoke else 5 if args.campaign == "rq1" else 3,
        conditions=args.nodes,
        timeout_seconds=args.timeout,
        server_environment="native localhost; same Graphviz binary for RQ1 and external PhyloLens",
        cpu_measurement="resource phase CPU deltas plus 20ms process-tree samples; core-equivalent mean is not a physical-core count",
        retention="generated persistence removed after recorded hashes unless --keep-persistence",
        browser="Chromium executable from eval/browser Playwright, common across external tools",
    )
    harness = [
        Path(__file__),
        ROOT / "scripts/evaluation_runtime.py",
        ROOT / "scripts/local_eval_server.py",
        ROOT / "eval/browser/src/external-comparison-runner.mjs",
        ROOT / "eval/browser/src/external-bitmap-validator.mjs",
    ]
    state["harness_sha256"] = {str(p.relative_to(ROOT)): file_hash(p) for p in harness}
    state["client_bundle_sha256"] = file_hash(product / "code/client/dist/index.js")
    for path in harness:
        target = directory / "harness" / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    write(directory / "manifest.json", state)
    shutil.copyfile(Path(__file__), directory / "harness-snapshot.py")
    sys.path.insert(0, str(product / "code/server/src"))
    from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

    wrappers = {}
    if args.campaign == "external":
        for tool in args.tools:
            target = directory / "wrappers" / tool
            wrappers[tool] = target
            state.setdefault("external_wrapper_source_sha256", {})[tool] = wrapper(
                args.thesis_root, tool, target, product
            )
            state.setdefault("tool_dependencies", {})[tool] = json.loads(
                (target / "package-lock.json").read_text()
            ).get("packages", {})
        state["visual_predicates"] = {
            "phylolens": "first post-ready rAF with nonuniform rendered geometry canvas, independently copied with createImageBitmap at 64x48; protocol v2 replaces historical 16x16 readPixels",
            "phylotree": "historical wrapper SVG geometry and positive visible bounds predicate",
            "taxonium": "historical wrapper native draw evidence and visible rendering surface predicate",
        }
        write(directory / "manifest.json", state)
    rows = []
    stopped, failures = set(), {}
    for count in args.nodes:
        dataset = args.thesis_root / f"data/salmonella/fullmst/tree_fullmst_{count}.nwk"
        content = dataset.read_text()
        canonical = normalize_dataset(
            NormalizeRequest(
                format="newick", dataset_name=dataset.stem, content=content
            )
        ).dataset
        assert len(canonical.nodes) == count and len(canonical.edges) == count - 1
        # Leaf cardinality belongs to rooted input, not undirected degree.
        from phylo_lens_server.pipeline.clustering import rooted_depths, tree_adjacency

        adjacency = tree_adjacency(canonical)
        depths = rooted_depths(adjacency, canonical.technical_roots)
        leaves = sum(
            not any(depths[n] > depths[node] for n, _ in adjacency[node])
            for node in adjacency
        )
        expected = {
            "nodes": count,
            "edges": count - 1,
            "leaves": leaves,
            "name": dataset.stem,
        }
        tools = ["phylolens"] if args.campaign == "rq1" else args.tools
        for tool in tools:
            if tool in stopped:
                continue
            cell = []
            for rep in range(state["measured_repetitions"] + 1):
                try:
                    check_storage(count)
                except OSError as error:
                    state.update(
                        state="interrupted_storage_guard", storage_error=str(error)
                    )
                    write(directory / "manifest.json", state)
                    raise
                observation = (
                    directory
                    / tool
                    / str(count)
                    / ("warmup" if rep == 0 else f"measured-{rep:03}")
                )
                observation.mkdir(parents=True)
                print(args.campaign, tool, count, rep, flush=True)
                row = {
                    "tool": tool,
                    "nodes": count,
                    "warmup": rep == 0,
                    "repetition": rep,
                    "source_sha256": file_hash(dataset),
                    "status": "failure",
                    "elapsed_ms": None,
                }
                try:
                    if tool == "phylolens":
                        with (
                            server(product, observation) as (url, service, persistence),
                            ProcessSampler(
                                service.pid, observation / "resources.jsonl"
                            ),
                        ):
                            if args.campaign == "rq1":
                                polls = []
                                start = time.perf_counter()
                                job = request(
                                    url + "/api/graph/prepare",
                                    {
                                        "format": "newick",
                                        "dataset_name": dataset.stem,
                                        "content": content,
                                    },
                                    timeout=args.timeout,
                                )
                                while True:
                                    status = request(
                                        url + "/api/graph/prepare/" + job["job_id"]
                                    )
                                    polls.append(
                                        {
                                            "monotonic_s": time.perf_counter(),
                                            "body": status,
                                        }
                                    )
                                    if status["status"] == "ready":
                                        row["elapsed_ms"] = (
                                            time.perf_counter() - start
                                        ) * 1000
                                        assert (
                                            status["result"]["node_count"] == count
                                            and status["result"]["edge_count"]
                                            == count - 1
                                        )
                                        assert (
                                            status["result"]["layout_status"] == "ready"
                                        )
                                        row.update(
                                            status="success", prepared=status["result"]
                                        )
                                        break
                                    if status["status"] == "failed":
                                        raise RuntimeError(str(status))
                                    if time.perf_counter() - start > args.timeout:
                                        raise TimeoutError("prepare-to-ready deadline")
                                    time.sleep(0.1)
                                write(observation / "polls.json", polls)
                            else:
                                row.update(
                                    browser_observation(
                                        args,
                                        observation,
                                        tool,
                                        wrappers[tool],
                                        dataset,
                                        expected,
                                        canonical,
                                        url,
                                    )
                                )
                    else:
                        row.update(
                            browser_observation(
                                args,
                                observation,
                                tool,
                                wrappers[tool],
                                dataset,
                                expected,
                                canonical,
                                None,
                            )
                        )
                except Exception as error:  # noqa: BLE001 -- retain every terminal failure
                    row.update(
                        status="timeout"
                        if isinstance(error, (TimeoutError, subprocess.TimeoutExpired))
                        else "failure",
                        error=f"{type(error).__name__}: {error}",
                    )
                finally:
                    persistence = observation / "persistence"
                    if persistence.exists():
                        generated = {
                            str(p.relative_to(persistence)): {
                                "bytes": p.stat().st_size,
                                "sha256": file_hash(p),
                            }
                            for p in persistence.rglob("*")
                            if p.is_file()
                        }
                        write(observation / "persistence-inventory.json", generated)
                        if not args.keep_persistence:
                            shutil.rmtree(persistence)
                    write(observation / "observation.json", row)
                    rows.append(row)
                    with (directory / "observations.jsonl").open("a") as f:
                        f.write(json.dumps(row) + "\n")
                    write(directory / "summary.json", summaries(rows))
                if rep:
                    cell.append(row)
            if args.campaign == "external":
                failures[tool] = (
                    failures.get(tool, 0) + 1
                    if all(r["status"] != "success" for r in cell)
                    else 0
                )
                if failures[tool] == 2:
                    stopped.add(tool)
                    write(
                        directory / "scaling-stops.json",
                        {
                            "stopped_tools": sorted(stopped),
                            "remaining_sizes": [n for n in args.nodes if n > count],
                        },
                    )
    state["state"] = "completed"
    state["product_source_unchanged"] = (
        source_hashes(product) == state["product_source_sha256"]
    )
    write(directory / "manifest.json", state)
    print("COMPLETED", directory, flush=True)
    return directory


def browser_observation(
    args, observation, tool, wrapper_path, dataset, expected, canonical, api_url
):
    control = {
        "tool": tool,
        "wrapper": str(wrapper_path),
        "port": free_port(),
        "dataset": str(dataset),
        "expected": expected,
        "labels": [n.id for n in canonical.nodes],
        "apiUrl": api_url,
        "screenshot": str(observation / "after.png"),
    }
    write(observation / "control.json", control)
    with (observation / "browser.log").open("w") as log:
        process = subprocess.Popen(
            [
                "rtk",
                "proxy",
                "node",
                str(ROOT / "eval/browser/src/external-comparison-runner.mjs"),
                str(observation / "control.json"),
                str(observation / "result.json"),
            ],
            cwd=ROOT,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
        deadline = args.timeout + 150 if tool == "phylolens" else 165
        try:
            code = process.wait(timeout=deadline)
        except subprocess.TimeoutExpired:
            # This process group contains only this observation's runner,
            # Vite and fresh Chromium; never signal unrelated processes.
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
        if code:
            raise subprocess.CalledProcessError(code, process.args)
    result = json.loads((observation / "result.json").read_text())
    if result["status"] == "success":
        elapsed = result.get("adapter", {}).get("time_to_first_visual_output_ms")
        if not isinstance(elapsed, (float, int)) or elapsed <= 0:
            raise ValueError("Missing positive first-visualization timing")
        if not result.get("gpu", {}).get("hardware_accelerated"):
            raise ValueError("Hardware-accelerated browser required")
    return {
        "status": result["status"],
        "elapsed_ms": result.get("adapter", {}).get("time_to_first_visual_output_ms"),
        "error": result.get("error"),
        "browser": result.get("browser"),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--campaign", choices=["rq1", "external"], required=True)
    p.add_argument("--product-root", type=Path, default=ROOT)
    p.add_argument("--thesis-root", type=Path, default=ROOT.parent / "Thesis")
    p.add_argument("--run-id", required=True)
    p.add_argument("--nodes", type=int, nargs="+", default=COUNTS)
    p.add_argument(
        "--tools",
        choices=["phylolens", "phylotree", "taxonium"],
        nargs="+",
        default=["phylolens", "phylotree", "taxonium"],
    )
    p.add_argument("--timeout", type=int, default=360)
    p.add_argument("--keep-persistence", action="store_true")
    p.add_argument("--smoke", action="store_true")
    p.add_argument("--validate-only", action="store_true")
    args = p.parse_args()
    if (
        Path(args.run_id).name != args.run_id
        or not args.nodes
        or any(n not in COUNTS for n in args.nodes)
    ):
        p.error("Use a simple new run ID and sizes from the retained Full-MST series")
    if args.validate_only:
        print(
            json.dumps(
                {
                    "campaign": args.campaign,
                    "sources": [
                        {
                            "nodes": n,
                            "path": str(
                                args.thesis_root
                                / f"data/salmonella/fullmst/tree_fullmst_{n}.nwk"
                            ),
                            "sha256": file_hash(
                                args.thesis_root
                                / f"data/salmonella/fullmst/tree_fullmst_{n}.nwk"
                            ),
                        }
                        for n in args.nodes
                    ],
                },
                indent=2,
            )
        )
    else:
        run(args)


if __name__ == "__main__":
    main()
