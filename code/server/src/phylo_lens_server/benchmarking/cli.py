from __future__ import annotations

import argparse
import sys

from phylo_lens_server.benchmarking.lod import (
    DEFAULT_REPEATS,
    benchmark_dataset,
    format_rows_as_json,
    format_rows_as_table,
    generate_balanced_binary_tree,
    generate_skewed_tree,
)


def main() -> None:
    """Run reproducible server-side LoD benchmarks on synthetic tree datasets."""
    parser = argparse.ArgumentParser(
        description="Benchmark hierarchy build and visible-slice selection.",
    )
    parser.add_argument(
        "--shapes",
        nargs="+",
        choices=["balanced", "skewed"],
        default=["balanced", "skewed"],
        help="Synthetic tree shapes to benchmark.",
    )
    parser.add_argument(
        "--sizes",
        nargs="+",
        type=int,
        default=[1_000, 10_000, 100_000],
        help="Node counts to benchmark for each selected shape.",
    )
    parser.add_argument(
        "--repeats",
        type=int,
        default=DEFAULT_REPEATS,
        help="Number of repeated runs per benchmark case.",
    )
    parser.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="Output format.",
    )
    args = parser.parse_args()

    if args.repeats < 1:
        raise SystemExit("--repeats must be >= 1")
    if any(size < 1 for size in args.sizes):
        raise SystemExit("--sizes values must be >= 1")

    rows = []
    for shape in args.shapes:
        for size in args.sizes:
            dataset = (
                generate_balanced_binary_tree(size)
                if shape == "balanced"
                else generate_skewed_tree(size)
            )
            rows.extend(benchmark_dataset(dataset, shape=shape, repeats=args.repeats))

    output = (
        format_rows_as_table(rows)
        if args.format == "table"
        else format_rows_as_json(rows)
    )
    sys.stdout.write(output)
    sys.stdout.write("\n")
