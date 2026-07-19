#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

from phylo_profile.comparison import (
    aggregate,
    comparison_rows,
    format_key,
    load_stage_durations,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare two server_profile.py JSONL outputs by stage median.",
    )
    parser.add_argument("baseline", type=Path)
    parser.add_argument("current", type=Path)
    parser.add_argument(
        "--fail-ratio",
        type=float,
        default=None,
        help="Exit non-zero if any shared stage median exceeds this ratio.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    baseline = aggregate(load_stage_durations(args.baseline))
    current = aggregate(load_stage_durations(args.current))
    failed = False

    print("status\tmedian_ratio\tbaseline_ms\tcurrent_ms\tbaseline_n\tcurrent_n\tkey")
    for key, before, after, ratio in comparison_rows(baseline, current):
        if before is None:
            status = "added"
        elif after is None:
            status = "removed"
        else:
            status = "ok"
            if args.fail_ratio is not None and ratio is not None:
                if ratio > args.fail_ratio:
                    status = "regressed"
                    failed = True

        ratio_text = "-" if ratio is None else f"{ratio:.3f}"
        before_ms = "-" if before is None else f"{before.median_ms:.3f}"
        after_ms = "-" if after is None else f"{after.median_ms:.3f}"
        before_count = "-" if before is None else str(before.count)
        after_count = "-" if after is None else str(after.count)
        print(
            f"{status}\t{ratio_text}\t{before_ms}\t{after_ms}\t"
            f"{before_count}\t{after_count}\t{format_key(key)}"
        )

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

