#!/usr/bin/env python3
from __future__ import annotations

import argparse
import cProfile
from pathlib import Path
import pstats
import tracemalloc
from uuid import uuid4

from phylo_profile.datasets import SYNTHETIC_SHAPES
from phylo_profile.metrics import JsonlSink, MetricRecorder, NullSink
from phylo_profile.paths import bootstrap_server_src
from phylo_profile.server_runner import ServerProfileConfig, run_one_dataset

bootstrap_server_src()

from phylo_lens_server.pipeline import layout as layout_module  # noqa: E402


DEFAULT_VIEWPORT_FRACTIONS = (0.05, 0.2, 1.0)
DEFAULT_LOD_LEVELS = (0, 1, 2, -1)
DEFAULT_LAYOUT_MAXITER = getattr(
    layout_module,
    "GRAPHVIZ_ROUGH_MAXITER",
    layout_module.GRAPHVIZ_BASE_MAXITER,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Profile PhyloLens server prepare/store/viewport hot paths.",
    )
    parser.add_argument("--sizes", nargs="+", type=int, default=[1000])
    parser.add_argument(
        "--shape",
        choices=SYNTHETIC_SHAPES,
        default="balanced",
    )
    parser.add_argument("--metadata-fields", type=int, default=4)
    parser.add_argument("--max-nodes", type=int, default=2500)
    parser.add_argument(
        "--viewport-fractions",
        nargs="+",
        type=float,
        default=list(DEFAULT_VIEWPORT_FRACTIONS),
    )
    parser.add_argument("--region-fraction", type=float, default=0.1)
    parser.add_argument(
        "--lod-levels",
        nargs="+",
        type=int,
        default=list(DEFAULT_LOD_LEVELS),
        help="Use -1 for the finest available tier.",
    )
    parser.add_argument(
        "--layout-maxiter",
        type=int,
        default=DEFAULT_LAYOUT_MAXITER,
        help="Graphviz sfdp maxiter for development profiling.",
    )
    parser.add_argument("--search-query", default="n000")
    parser.add_argument("--seed", type=int, default=23)
    parser.add_argument(
        "--warmups",
        type=int,
        default=0,
        help="Run this many unrecorded warmup passes per dataset size.",
    )
    parser.add_argument(
        "--repetitions",
        type=int,
        default=1,
        help="Run this many recorded repetitions per dataset size.",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cprofile", type=Path)
    return parser.parse_args()


def config_from_args(args: argparse.Namespace) -> ServerProfileConfig:
    return ServerProfileConfig(
        shape=args.shape,
        metadata_fields=args.metadata_fields,
        max_nodes=args.max_nodes,
        viewport_fractions=tuple(args.viewport_fractions),
        region_fraction=args.region_fraction,
        lod_levels=tuple(args.lod_levels),
        layout_maxiter=args.layout_maxiter,
        search_query=args.search_query,
        seed=args.seed,
    )


def main() -> None:
    args = parse_args()
    config = config_from_args(args)
    sink = JsonlSink(args.output)
    run_id = str(uuid4())
    tracemalloc.start()
    profiler = cProfile.Profile() if args.cprofile is not None else None
    try:
        run_warmups(args=args, config=config, run_id=run_id)
        if profiler is not None:
            profiler.enable()
        for size in args.sizes:
            for repetition in range(1, max(args.repetitions, 1) + 1):
                recorder = MetricRecorder(
                    sink,
                    {
                        "run_id": run_id,
                        "shape": config.shape,
                        "target_nodes": size,
                        "repetition": repetition,
                    },
                )
                run_one_dataset(config=config, recorder=recorder, size=size)
    finally:
        if profiler is not None:
            profiler.disable()
            args.cprofile.parent.mkdir(parents=True, exist_ok=True)
            profiler.dump_stats(args.cprofile)
            stats = pstats.Stats(profiler).sort_stats("cumtime")
            stats.print_stats(25)
        sink.close()
        tracemalloc.stop()


def run_warmups(
    *,
    args: argparse.Namespace,
    config: ServerProfileConfig,
    run_id: str,
) -> None:
    if args.warmups <= 0:
        return
    sink = NullSink()
    try:
        for size in args.sizes:
            for warmup in range(1, args.warmups + 1):
                recorder = MetricRecorder(
                    sink,
                    {
                        "run_id": run_id,
                        "shape": config.shape,
                        "target_nodes": size,
                        "warmup": warmup,
                    },
                )
                run_one_dataset(config=config, recorder=recorder, size=size)
    finally:
        sink.close()


if __name__ == "__main__":
    main()
