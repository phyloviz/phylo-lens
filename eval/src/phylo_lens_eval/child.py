"""RQ1 child process: normalization through SQLite publication for one preparation.

RQ: RQ1 server-side preparation scalability.
Command: invoked by ``phylo_lens_eval.rq1`` with ``--request`` and ``--output``.
Input: a validated JSON request with a direct-tree dataset and empty persistence directory.
Timing: starts before parsing and ends after publication; stage times may overlap only by
their explicit boundaries and are never summed into wall time.
Output: one versioned observation JSON. Limitations: process-tree RSS is sampled by parent.
"""

from __future__ import annotations

import argparse
import json
import time
from contextlib import AbstractContextManager
from pathlib import Path

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.services.graph_service import ensure_graph_edge_distances

from . import SCHEMA_VERSION
from .common import persisted_size_bytes, validate_observation, write_json


class StageTimer(AbstractContextManager[None]):
    def __init__(self, durations: dict[str, float], name: str) -> None:
        self.durations, self.name, self.started = durations, name, 0.0

    def __enter__(self) -> None:
        self.started = time.perf_counter()
        return None

    def __exit__(self, *_args) -> None:
        self.durations[self.name] = self.durations.get(self.name, 0.0) + (
            time.perf_counter() - self.started
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Execute one isolated direct-tree RQ1 preparation."
    )
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    input_path = Path(request["dataset_path"])
    persistence_dir = Path(request["persistence_dir"])
    stages: dict[str, float] = {}
    started = time.perf_counter()
    try:
        normalized = normalize_dataset(
            NormalizeRequest(
                format=request["dataset_format"],
                dataset_name=request["dataset_id"],
                content=input_path.read_text(encoding="utf-8"),
            ),
            expose_internal_schema=True,
        )
        stages["parsing"] = normalized.stats.ingest_ms / 1000
        stages["normalization"] = normalized.stats.normalize_ms / 1000
        dataset, distance_warnings = ensure_graph_edge_distances(normalized.dataset)
        count_warnings = _declared_count_warnings(request, dataset)
        worker = PreparedLayoutWorker(
            PreparedLayoutStore(persistence_dir),
            stage_factory=lambda name: StageTimer(stages, name),
        )
        result = worker.prepare_dataset(dataset)
        observation = {
            "schema_version": SCHEMA_VERSION,
            "observation_id": request["observation_id"],
            "dataset_id": request["dataset_id"],
            "warmup": request["warmup"],
            "state": "success",
            "failure_classification": "none",
            "wall_time_seconds": time.perf_counter() - started,
            "stage_durations_seconds": stages,
            "input_bytes": input_path.stat().st_size,
            "persisted_artifact_bytes": persisted_size_bytes(persistence_dir),
            "declared_node_count": request.get("declared_node_count"),
            "declared_edge_count": request.get("declared_edge_count"),
            "observed_node_count": len(dataset.nodes),
            "edge_count": len(dataset.edges),
            "lod_tier_count": len(
                {cluster.threshold for cluster in result.artifacts.clusters}
            ),
            "cluster_count": len(result.artifacts.clusters),
            "layout_status": result.layout_status,
            "warnings": normalized.warnings
            + distance_warnings
            + count_warnings
            + (
                [result.layout_degraded_reason] if result.layout_degraded_reason else []
            ),
            "exit_status": 0,
            "error": None,
            "peak_rss_bytes": None,
            "peak_rss_scope": "sampled_process_tree",
        }
    except Exception as error:
        observation = {
            "schema_version": SCHEMA_VERSION,
            "observation_id": request["observation_id"],
            "dataset_id": request["dataset_id"],
            "warmup": request["warmup"],
            "state": "failed",
            "failure_classification": "runtime_error",
            "wall_time_seconds": time.perf_counter() - started,
            "stage_durations_seconds": stages,
            "warnings": [],
            "error": f"{type(error).__name__}: {error}",
            "exit_status": 1,
            "peak_rss_bytes": None,
            "peak_rss_scope": "sampled_process_tree",
        }
        write_json(args.output, observation)
        raise
    validate_observation(observation)
    write_json(args.output, observation)


def _declared_count_warnings(request: dict, dataset) -> list[str]:
    warnings: list[str] = []
    declared_nodes = request.get("declared_node_count")
    declared_edges = request.get("declared_edge_count")
    if declared_nodes is not None and declared_nodes != len(dataset.nodes):
        warnings.append(
            f"Declared node count {declared_nodes} differs from observed count {len(dataset.nodes)}."
        )
    if declared_edges is not None and declared_edges != len(dataset.edges):
        warnings.append(
            f"Declared edge count {declared_edges} differs from observed count {len(dataset.edges)}."
        )
    return warnings


if __name__ == "__main__":
    main()
