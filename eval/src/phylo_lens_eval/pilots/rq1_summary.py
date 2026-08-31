"""Regenerate RQ1 summaries from raw observations without changing raw data.

RQ: RQ1 server-side preparation scalability.
Command: ``PYTHONPATH=eval/src python -m phylo_lens_eval.summarize <run-directory>``.
Input: raw ``observations.jsonl`` files. Output: per-dataset and run ``summary.json``.
Warm-ups and failed observations remain raw; statistics use successful measured observations only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .. import SCHEMA_VERSION
from ..core.common import write_json
from ..core.stats import summarize_observations


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Regenerate summaries from PhyloLens RQ1 raw observations."
    )
    parser.add_argument("run_directory", type=Path)
    args = parser.parse_args()
    datasets: dict[str, dict] = {}
    for file in sorted((args.run_directory / "datasets").glob("*/observations.jsonl")):
        observations = [
            json.loads(line)
            for line in file.read_text(encoding="utf-8").splitlines()
            if line
        ]
        summary = summarize_observations(observations)
        write_json(file.parent / "summary.json", summary)
        datasets[file.parent.name] = summary
    write_json(
        args.run_directory / "summary.json",
        {"schema_version": SCHEMA_VERSION, "datasets": datasets},
    )


if __name__ == "__main__":
    main()
