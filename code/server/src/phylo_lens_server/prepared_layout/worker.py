from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor

from phylo_lens_server.core.models import CanonicalDataset
from phylo_lens_server.prepared_layout.ingest import prepare_layout_artifacts
from phylo_lens_server.prepared_layout.layout import compute_prepared_layouts
from phylo_lens_server.prepared_layout.models import (
    LayoutStatus,
    PreparedEdge,
    PreparedLayoutArtifacts,
    PreparedLayoutResult,
)
from phylo_lens_server.prepared_layout.store.prepared_layout_store import (
    PreparedLayoutStore,
)


class PreparedLayoutWorker:
    """Background-friendly worker that prepares and persists layout artifacts."""

    def __init__(
        self,
        store: PreparedLayoutStore,
        executor: ThreadPoolExecutor | None = None,
    ) -> None:
        self.store = store
        self._executor = executor
        self._owns_executor = executor is None

    def prepare_dataset(self, dataset: CanonicalDataset) -> PreparedLayoutResult:
        self.store.clear_dataset(dataset.dataset_id)
        artifacts = prepare_layout_artifacts(dataset)
        self.store.save_artifacts(artifacts)
        prepared_edges = compute_prepared_edges(artifacts)
        cluster_layouts, node_positions, degraded_reason = compute_prepared_layouts(
            artifacts
        )
        self.store.save_layouts(cluster_layouts, node_positions)
        self.store.save_prepared_edges(prepared_edges)
        layout_status: LayoutStatus = (
            cluster_layouts[0].status
            if cluster_layouts
            else node_positions[0].status if node_positions else "ready"
        )
        return PreparedLayoutResult(
            artifacts=artifacts,
            cluster_layouts=cluster_layouts,
            node_positions=node_positions,
            prepared_edges=prepared_edges,
            layout_status=layout_status,
            layout_degraded_reason=degraded_reason,
        )

    @property
    def executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1)
        return self._executor

    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]:
        return self.executor.submit(self.prepare_dataset, dataset)

    def shutdown(self) -> None:
        if self._owns_executor and self._executor is not None:
            self._executor.shutdown(wait=True)


def compute_prepared_edges(
    artifacts: PreparedLayoutArtifacts,
) -> tuple[PreparedEdge, ...]:
    prepared_by_key: dict[tuple[int, str, str], PreparedEdge] = {}
    thresholds = tuple(
        sorted(
            {
                cluster.threshold
                for cluster in artifacts.clusters
                if cluster.threshold is not None
            },
            reverse=True,
        )
    )

    for lod_level, threshold in enumerate(thresholds):
        clusters = tuple(
            cluster for cluster in artifacts.clusters if cluster.threshold == threshold
        )
        node_to_rep = {
            node_id: cluster.representative_node_id
            for cluster in clusters
            for node_id in cluster.member_node_ids
        }

        for edge in artifacts.dataset.edges:
            source_rep = node_to_rep.get(edge.source)
            target_rep = node_to_rep.get(edge.target)
            if source_rep is None or target_rep is None or source_rep == target_rep:
                continue

            source, target = sorted((source_rep, target_rep))
            key = (lod_level, source, target)
            current = prepared_by_key.get(key)
            if current is not None and _edge_distance(current) <= _raw_distance(
                edge.distance
            ):
                continue

            prepared_by_key[key] = PreparedEdge(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                lod_level=lod_level,
                edge_id=f"quotient_edge:{lod_level}:{source}:{target}",
                source=source,
                target=target,
                distance=edge.distance,
            )

    return tuple(
        prepared_by_key[key]
        for key in sorted(prepared_by_key, key=lambda item: (item[0], item[1], item[2]))
    )


def _edge_distance(edge: PreparedEdge) -> float:
    return _raw_distance(edge.distance)


def _raw_distance(distance: float | None) -> float:
    return float("inf") if distance is None else distance
