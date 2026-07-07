from __future__ import annotations

from collections import Counter
from dataclasses import replace
import json
from pathlib import Path
import sqlite3

import re

from phylo_lens_server.core.metadata_keys import is_internal_metadata_key
from phylo_lens_server.prepared_layout.models import (
    ClusterLayout,
    LayoutBounds,
    LayoutStatus,
    MetadataSchemaField,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    PreparedEdge,
    RegionReadResult,
    SearchMatch,
    SearchReadResult,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)

DEFAULT_DB_NAME = "prepared_layout.sqlite3"

MetadataValue = str | float | bool | None
MetadataMap = dict[str, MetadataValue]

# Relevance tiers for node search (higher = better). A node-id hit always
# outranks a match that came only from a metadata value, mirroring the intent of
# the former client-side scorer so result ordering is unchanged.
SEARCH_SCORE_ID_EXACT = 100
SEARCH_SCORE_ID_PREFIX = 60
SEARCH_SCORE_ID_SUBSTRING = 40
SEARCH_SCORE_METADATA_VALUE = 20

# The Newick parser only ever emits generated structural ids of the shape
# ``union_<counter>`` (with optional ``_<n>`` collision suffixes). These are
# junctions, never real isolates, and must never surface as search results.
_GENERATED_UNION_NODE_ID = re.compile(r"^union_[0-9]+(?:_[0-9]+)*$")


def _is_union_node_id(node_id: str) -> bool:
    return _GENERATED_UNION_NODE_ID.match(node_id) is not None


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a raw needle matches literally under ESCAPE."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _first_matching_value(metadata: MetadataMap, lowered_needle: str) -> str | None:
    """Return the first public metadata value containing the needle, or None.

    The broad ``metadata_json LIKE`` prefilter can match on internal keys or on
    the JSON structure itself, so each candidate row is re-checked here against
    only its public, non-null field values.
    """
    for key, value in metadata.items():
        if value is None or is_internal_metadata_key(key):
            continue
        text = str(value)
        if lowered_needle in text.lower():
            return text
    return None


def aggregate_layout_status(statuses: set[LayoutStatus]) -> LayoutStatus:
    """Collapse per-row layout statuses into one status for a viewport.

    Precedence keeps degraded layouts honest: a failed row wins, then a
    ``"degraded"`` (circular-fallback) row, so a fallback layout never surfaces
    as ``"ready"``. A viewport is ``"ready"`` only when every row is ready; a
    non-empty mix is ``"refining"``; an empty set is ``"pending"``.
    """
    if not statuses:
        return "pending"
    if "failed" in statuses:
        return "failed"
    if "degraded" in statuses:
        return "degraded"
    if statuses == {"ready"}:
        return "ready"
    return "refining"


def aggregate_cluster_metadata(
    member_metadata: list[MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    """Reduce member metadata to one value per field for a cluster representative.

    Numeric fields use the mean of non-null values; every other field type uses
    the most common non-null value with a deterministic alphabetical tie-break.
    """
    aggregate: MetadataMap = {}
    for key, field_type in schema:
        values = [
            metadata[key]
            for metadata in member_metadata
            if metadata.get(key) is not None
        ]
        if not values:
            continue
        if field_type == "number":
            numeric = [
                value
                for value in values
                if isinstance(value, (int, float)) and not isinstance(value, bool)
            ]
            if numeric:
                aggregate[key] = sum(numeric) / len(numeric)
            continue
        counts = Counter(values)
        best_count = max(counts.values())
        aggregate[key] = min(
            (value for value, count in counts.items() if count == best_count),
            key=str,
        )
    return aggregate


def optional_node_bounds_filter(
    *,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> tuple[str, tuple[float, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and np.x between ? and ? and np.y between ? and ?", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def optional_cluster_bounds_filter(
    *,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> tuple[str, tuple[float, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and max_x >= ? and min_x <= ? and max_y >= ? and min_y <= ?", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def has_bounds(
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> bool:
    return None not in (xmin, xmax, ymin, ymax)


def _min_distance(left: float | None, right: float | None) -> float | None:
    """Minimum of two optional distances, treating None as "no distance".

    Used when folding several boundary edges into one meta-edge: the bundled
    distance is the shortest concrete edge, and stays None only when every
    folded edge lacked a distance.
    """
    if left is None:
        return right
    if right is None:
        return left
    return left if left <= right else right


class PreparedLayoutStore:
    """SQLite store for materialized layout artifacts consumed by a read API."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / DEFAULT_DB_NAME
        # Threshold lists are immutable after prepare; cache them to avoid a
        # full-table scan on prepared_clusters for every viewport request.
        self._threshold_cache: dict[tuple[str, str], tuple[float, ...]] = {}
        self._init_schema()

    def clear_dataset(self, dataset_id: str) -> None:
        # Evict all cached threshold lists for this dataset so re-preparing
        # does not serve stale thresholds from the old layout version.
        self._threshold_cache = {
            key: value
            for key, value in self._threshold_cache.items()
            if key[0] != dataset_id
        }
        with self._connect() as connection:
            for table in (
                "node_positions",
                "prepared_edges",
                "graph_edges",
                "cluster_members",
                "prepared_clusters",
                "datasets",
                "cluster_edges",
                "node_metadata",
                "cluster_metadata",
                "metadata_schema",
            ):
                if not self._table_exists(connection, table):
                    continue
                connection.execute(
                    f"delete from {table} where dataset_id = ?",
                    (dataset_id,),
                )

    def save_artifacts(self, artifacts: PreparedLayoutArtifacts) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                insert into datasets(dataset_id, layout_version, status)
                values (?, ?, ?)
                on conflict(dataset_id, layout_version) do update set
                    status = excluded.status
                """,
                (artifacts.dataset.dataset_id, artifacts.layout_version, "refining"),
            )
            connection.executemany(
                """
                insert into prepared_clusters(
                    dataset_id, layout_version, cluster_id, threshold,
                    representative_node_id, member_count, status
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, cluster_id) do update set
                    threshold = excluded.threshold,
                    representative_node_id = excluded.representative_node_id,
                    member_count = excluded.member_count,
                    status = excluded.status
                """,
                [
                    (
                        artifacts.dataset.dataset_id,
                        artifacts.layout_version,
                        cluster.cluster_id,
                        cluster.threshold,
                        cluster.representative_node_id,
                        cluster.member_count,
                        "pending",
                    )
                    for cluster in artifacts.clusters
                ],
            )
            connection.executemany(
                """
                insert into cluster_members(
                    dataset_id, layout_version, cluster_id, node_id
                )
                values (?, ?, ?, ?)
                on conflict do nothing
                """,
                [
                    (
                        artifacts.dataset.dataset_id,
                        artifacts.layout_version,
                        cluster.cluster_id,
                        node_id,
                    )
                    for cluster in artifacts.clusters
                    for node_id in cluster.member_node_ids
                ],
            )
            connection.executemany(
                """
                insert into graph_edges(
                    dataset_id, layout_version, edge_id,
                    source_node_id, target_node_id, distance
                )
                values (?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, edge_id) do update set
                    source_node_id = excluded.source_node_id,
                    target_node_id = excluded.target_node_id,
                    distance = excluded.distance
                """,
                [
                    (
                        artifacts.dataset.dataset_id,
                        artifacts.layout_version,
                        edge.id,
                        edge.source,
                        edge.target,
                        edge.distance,
                    )
                    for edge in artifacts.dataset.edges
                ],
            )
            self._persist_metadata(connection, artifacts)

    def _persist_metadata(
        self,
        connection: sqlite3.Connection,
        artifacts: PreparedLayoutArtifacts,
    ) -> None:
        dataset_id = artifacts.dataset.dataset_id
        layout_version = artifacts.layout_version
        public_fields = tuple(
            (field.key, str(field.type))
            for field in artifacts.dataset.metadata_schema
            if not is_internal_metadata_key(field.key)
        )
        public_keys = {key for key, _ in public_fields}

        connection.executemany(
            """
            insert into metadata_schema(
                dataset_id, layout_version, field_key, field_type
            )
            values (?, ?, ?, ?)
            on conflict(dataset_id, layout_version, field_key) do update set
                field_type = excluded.field_type
            """,
            [
                (dataset_id, layout_version, key, field_type)
                for key, field_type in public_fields
            ],
        )

        metadata_by_node = artifacts.dataset.metadata_by_node_id
        public_metadata_by_node = {
            node_id: {
                key: value
                for key, value in metadata.items()
                if key in public_keys
            }
            for node_id, metadata in metadata_by_node.items()
        }
        connection.executemany(
            """
            insert into node_metadata(
                dataset_id, layout_version, node_id, metadata_json
            )
            values (?, ?, ?, ?)
            on conflict(dataset_id, layout_version, node_id) do update set
                metadata_json = excluded.metadata_json
            """,
            [
                (dataset_id, layout_version, node_id, json.dumps(metadata))
                for node_id, metadata in public_metadata_by_node.items()
            ],
        )

        connection.executemany(
            """
            insert into cluster_metadata(
                dataset_id, layout_version, cluster_id, metadata_json
            )
            values (?, ?, ?, ?)
            on conflict(dataset_id, layout_version, cluster_id) do update set
                metadata_json = excluded.metadata_json
            """,
            [
                (
                    dataset_id,
                    layout_version,
                    cluster.cluster_id,
                    json.dumps(
                        aggregate_cluster_metadata(
                            [
                                public_metadata_by_node.get(node_id, {})
                                for node_id in cluster.member_node_ids
                            ],
                            public_fields,
                        )
                    ),
                )
                for cluster in artifacts.clusters
            ],
        )

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
    ) -> None:
        with self._connect() as connection:
            connection.executemany(
                """
                insert into prepared_clusters(
                    dataset_id, layout_version, cluster_id, representative_node_id,
                    member_count, x, y, radius, min_x, max_x, min_y, max_y, status
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, cluster_id) do update set
                    representative_node_id = excluded.representative_node_id,
                    member_count = excluded.member_count,
                    x = excluded.x,
                    y = excluded.y,
                    radius = excluded.radius,
                    min_x = excluded.min_x,
                    max_x = excluded.max_x,
                    min_y = excluded.min_y,
                    max_y = excluded.max_y,
                    status = excluded.status
                """,
                [
                    (
                        layout.dataset_id,
                        layout.layout_version,
                        layout.cluster_id,
                        layout.representative_node_id,
                        layout.member_count,
                        layout.x,
                        layout.y,
                        layout.radius,
                        layout.bounds.min_x,
                        layout.bounds.max_x,
                        layout.bounds.min_y,
                        layout.bounds.max_y,
                        layout.status,
                    )
                    for layout in cluster_layouts
                ],
            )
            connection.executemany(
                """
                insert into node_positions(
                    dataset_id, layout_version, cluster_id, node_id,
                    x, y, status
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, cluster_id, node_id)
                do update set
                    x = excluded.x,
                    y = excluded.y,
                    status = excluded.status
                """,
                [
                    (
                        position.dataset_id,
                        position.layout_version,
                        position.cluster_id,
                        position.node_id,
                        position.x,
                        position.y,
                        position.status,
                    )
                    for position in node_positions
                ],
            )
            if cluster_layouts:
                first = cluster_layouts[0]
                connection.execute(
                    """
                    update datasets set status = ?, updated_at = current_timestamp
                    where dataset_id = ? and layout_version = ?
                    """,
                    (first.status, first.dataset_id, first.layout_version),
                )

    def save_prepared_edges(self, prepared_edges: tuple[PreparedEdge, ...]) -> None:
        if not prepared_edges:
            return
        with self._connect() as connection:
            first = prepared_edges[0]
            connection.execute(
                """
                delete from prepared_edges
                where dataset_id = ? and layout_version = ?
                """,
                (first.dataset_id, first.layout_version),
            )
            connection.executemany(
                """
                insert into prepared_edges(
                    dataset_id, layout_version, lod_level, edge_id,
                    source_node_id, target_node_id, distance
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, lod_level, edge_id)
                do update set
                    source_node_id = excluded.source_node_id,
                    target_node_id = excluded.target_node_id,
                    distance = excluded.distance
                """,
                [
                    (
                        edge.dataset_id,
                        edge.layout_version,
                        edge.lod_level,
                        edge.edge_id,
                        edge.source,
                        edge.target,
                        edge.distance,
                    )
                    for edge in prepared_edges
                ],
            )

    def load_cluster_layouts(
        self,
        dataset_id: str,
        layout_version: str,
    ) -> list[ClusterLayout]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, representative_node_id, member_count,
                       x, y, radius, min_x, max_x, min_y, max_y, status
                from prepared_clusters
                where dataset_id = ? and layout_version = ? and x is not null
                order by cluster_id
                """,
                (dataset_id, layout_version),
            ).fetchall()

        return [
            ClusterLayout(
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=row["cluster_id"],
                representative_node_id=row["representative_node_id"],
                member_count=row["member_count"],
                x=row["x"],
                y=row["y"],
                radius=row["radius"],
                bounds=LayoutBounds(
                    min_x=row["min_x"],
                    max_x=row["max_x"],
                    min_y=row["min_y"],
                    max_y=row["max_y"],
                ),
                status=row["status"],
            )
            for row in rows
        ]

    def load_node_positions(
        self,
        dataset_id: str,
        layout_version: str,
    ) -> list[NodeLayoutPosition]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, node_id, x, y, status
                from node_positions
                where dataset_id = ? and layout_version = ?
                order by cluster_id, node_id
                """,
                (dataset_id, layout_version),
            ).fetchall()

        return [
            NodeLayoutPosition(
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=row["cluster_id"],
                node_id=row["node_id"],
                x=row["x"],
                y=row["y"],
                status=row["status"],
            )
            for row in rows
        ]

    def latest_layout_version(self, dataset_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select layout_version
                from datasets
                where dataset_id = ?
                order by updated_at desc, created_at desc, layout_version desc
                limit 1
                """,
                (dataset_id,),
            ).fetchone()
        return None if row is None else row["layout_version"]

    def read_viewport(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
        lod_level: int | None = None,
        cluster_id: str | None = None,
    ) -> ViewportReadResult:
        """Read one viewport, choosing among four mutually exclusive read paths.

        1. ``cluster_id`` set: expand a single cluster into its member nodes.
        2. ``lod_level == 0`` with no bounds: the coarse overview, which reads
           cluster representatives for the coarsest threshold (or falls back to
           distinct node positions when the tree resolves to one cluster).
        3. no threshold for this level: individual "ready" nodes within bounds.
        4. otherwise: cluster representatives for the level's threshold, within
           bounds.

        Bounds filtering applies to the representative and ready-node paths; the
        cluster-expansion path (1) intentionally ignores bounds so an opened
        cluster always returns all of its members.
        """
        with self._connect() as connection:
            if cluster_id:
                nodes, total_node_count = self._read_cluster_member_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    cluster_id=cluster_id,
                    max_nodes=max_nodes,
                )
                member_ids = {node.node_id for node in nodes}
                edges = self._read_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=member_ids,
                )
                # Keep the expanded members connected to the still-collapsed
                # rest of the tree by rerouting their boundary edges to the
                # neighbor representatives at the cluster's threshold. The
                # surfaced neighbor representatives are appended so every
                # meta-edge references a returned node (visibility invariant).
                meta_edges, neighbor_reps = self._read_expansion_meta_edges(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    cluster_id=cluster_id,
                    member_ids=member_ids,
                )
                nodes = list(nodes) + neighbor_reps
                edges = list(edges) + meta_edges
                layout_status = aggregate_layout_status(
                    {node.layout_status for node in nodes}
                )
                enriched = self._attach_node_metadata(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    nodes=tuple(nodes),
                )
                return ViewportReadResult(
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    nodes=enriched,
                    edges=tuple(edges),
                    total_node_count=total_node_count,
                    truncated=total_node_count > len(enriched),
                    layout_status=layout_status,
                    metadata_schema=self._load_metadata_schema(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                    ),
                )

            threshold = self._threshold_for_lod_level(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                lod_level=lod_level,
            )
            if lod_level == 0 and not has_bounds(xmin, xmax, ymin, ymax):
                nodes, total_node_count, edges = self._read_lod_zero_without_bounds(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    threshold=threshold,
                    max_nodes=max_nodes,
                )
            elif threshold is None:
                ready_nodes, total_node_count = self._read_ready_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    xmin=xmin,
                    xmax=xmax,
                    ymin=ymin,
                    ymax=ymax,
                    max_nodes=max_nodes,
                )
                nodes: tuple[ViewportNode, ...] = tuple(ready_nodes)
                viewport_node_ids = {node.node_id for node in nodes}
                edges = self._read_edges_touching_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=viewport_node_ids,
                )
                # Edges straddling the viewport boundary reference a neighbor
                # just off-screen. Surface those neighbor positions so the
                # client keeps the boundary edges instead of dropping them for
                # a missing endpoint. These neighbors are a connectivity aid,
                # not part of the in-viewport slice, so they are surfaced in
                # full even when the viewport slice already fills ``max_nodes``.
                # Capping them to the leftover budget (which collapses to zero
                # in dense viewports) is what previously dropped boundary edges
                # again. Neighbors are a small fraction of the slice, so the
                # bounded overflow is acceptable.
                neighbor_ids = {
                    endpoint
                    for edge in edges
                    for endpoint in (edge.source, edge.target)
                    if endpoint not in viewport_node_ids
                }
                neighbors = tuple(
                    self._read_node_positions_by_ids(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        node_ids=neighbor_ids,
                        max_nodes=len(neighbor_ids),
                    )
                    if neighbor_ids
                    else ()
                )
                nodes = nodes + neighbors
                # Drop edges whose off-screen endpoint could not be surfaced
                # (budget exhausted) so both endpoints of every returned edge
                # are always present for the client.
                present_ids = viewport_node_ids | {
                    node.node_id for node in neighbors
                }
                edges = [
                    edge
                    for edge in edges
                    if edge.source in present_ids and edge.target in present_ids
                ]
                # Count surfaced neighbors into the total so the truncation
                # check keeps reflecting whether the in-viewport slice was
                # capped.
                total_node_count += len(neighbors)
            else:
                nodes = tuple(
                    self._read_cluster_representatives(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        threshold=threshold,
                        xmin=xmin,
                        xmax=xmax,
                        ymin=ymin,
                        ymax=ymax,
                        max_nodes=max_nodes,
                    )
                )
                total_node_count = self._count_clusters_for_threshold(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    threshold=threshold,
                    xmin=xmin,
                    xmax=xmax,
                    ymin=ymin,
                    ymax=ymax,
                )
                edges = self._read_prepared_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    lod_level=lod_level or 0,
                    node_ids={node.node_id for node in nodes},
                )

            nodes = self._attach_node_metadata(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                nodes=nodes,
            )
            metadata_schema = self._load_metadata_schema(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
            )

        layout_status = aggregate_layout_status(
            {node.layout_status for node in nodes}
        )
        return ViewportReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
            edges=tuple(edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(nodes),
            layout_status=layout_status,
            metadata_schema=metadata_schema,
        )

    def read_region(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float,
        xmax: float,
        ymin: float,
        ymax: float,
        max_nodes: int,
    ) -> RegionReadResult:
        """Read an isolated subgraph for a hand-drawn selection box.

        Unlike :meth:`read_viewport`, this returns only the nodes whose layout
        coordinates fall strictly inside the box and only the edges whose *both*
        endpoints are inside it (an internal-only subgraph, no boundary edges),
        plus one aggregated metadata value per field across the selected
        members. It is the source of the region-selection stats panel.
        """
        with self._connect() as connection:
            ready_nodes, total_node_count = self._read_ready_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                xmin=xmin,
                xmax=xmax,
                ymin=ymin,
                ymax=ymax,
                max_nodes=max_nodes,
            )
            nodes: tuple[ViewportNode, ...] = tuple(ready_nodes)
            node_ids = {node.node_id for node in nodes}
            edges = self._read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=node_ids,
            )
            nodes = self._attach_node_metadata(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                nodes=nodes,
            )
            metadata_schema = self._load_metadata_schema(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
            )

        aggregated_metadata = aggregate_cluster_metadata(
            [node.metadata or {} for node in nodes],
            tuple((field.key, field.type) for field in metadata_schema),
        )
        layout_status = aggregate_layout_status(
            {node.layout_status for node in nodes}
        )
        return RegionReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
            edges=tuple(edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(nodes),
            layout_status=layout_status,
            metadata_schema=metadata_schema,
            aggregated_metadata=aggregated_metadata,
        )

    def search_nodes(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        query: str,
        limit: int,
    ) -> SearchReadResult:
        """Search the whole prepared tree by node id and metadata value.

        Unlike the viewport reads, this ignores layout coordinates and LoD tiers
        entirely: it scans every materialized leaf for the dataset so a match is
        found regardless of the current zoom/pan. Two indexed passes drive it:

        1. A ``node_id LIKE`` scan (backed by ``idx_node_positions_node_id``)
           yields id hits, scored exact > prefix > substring.
        2. A ``metadata_json LIKE`` scan yields candidate rows whose stored JSON
           contains the needle; each candidate's public fields are checked in
           Python so only genuine value matches (not internal keys) score.

        Results are merged (a node keeps its best score), union junctions are
        dropped, and the list is sorted by score then node id before ``limit``.
        """
        needle = query.strip()
        if not needle:
            return SearchReadResult(
                dataset_id=dataset_id,
                layout_version=layout_version,
                query=query.strip(),
                matches=(),
                total_count=0,
            )

        with self._connect() as connection:
            best: dict[str, SearchMatch] = {}
            self._search_by_node_id(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                needle=needle,
                best=best,
            )
            self._search_by_metadata_value(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                needle=needle,
                best=best,
            )

            ordered = sorted(
                best.values(),
                key=lambda match: (-match.score, match.node_id),
            )
            total_count = len(ordered)
            limited = list(ordered[:limit]) if limit >= 0 else list(ordered)
            # Resolve global layout coordinates only for the returned page so a
            # client can center/highlight a hit that lies outside the current
            # LoD slice by fetching a bounded region around these coordinates.
            coordinates = self._node_coordinates(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=[match.node_id for match in limited],
            )
        matches = tuple(
            replace(
                match,
                x=coordinates.get(match.node_id, (None, None))[0],
                y=coordinates.get(match.node_id, (None, None))[1],
            )
            for match in limited
        )
        return SearchReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            query=needle,
            matches=matches,
            total_count=total_count,
        )

    def _search_by_node_id(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        needle: str,
        best: dict[str, SearchMatch],
    ) -> None:
        pattern = f"%{_escape_like(needle)}%"
        rows = connection.execute(
            """
            select distinct node_id
            from node_positions
            where dataset_id = ?
              and layout_version = ?
              and node_id like ? escape '\\'
            """,
            (dataset_id, layout_version, pattern),
        ).fetchall()
        lowered = needle.lower()
        for row in rows:
            node_id = row["node_id"]
            if _is_union_node_id(node_id):
                continue
            lower_id = node_id.lower()
            if lower_id == lowered:
                score = SEARCH_SCORE_ID_EXACT
            elif lower_id.startswith(lowered):
                score = SEARCH_SCORE_ID_PREFIX
            else:
                score = SEARCH_SCORE_ID_SUBSTRING
            self._record_match(
                best,
                node_id=node_id,
                score=score,
                matched_text=node_id,
            )

    def _search_by_metadata_value(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        needle: str,
        best: dict[str, SearchMatch],
    ) -> None:
        pattern = f"%{_escape_like(needle)}%"
        rows = connection.execute(
            """
            select node_id, metadata_json
            from node_metadata
            where dataset_id = ?
              and layout_version = ?
              and metadata_json like ? escape '\\'
            """,
            (dataset_id, layout_version, pattern),
        ).fetchall()
        lowered = needle.lower()
        for row in rows:
            node_id = row["node_id"]
            if _is_union_node_id(node_id):
                continue
            metadata: MetadataMap = json.loads(row["metadata_json"])
            matched_value = _first_matching_value(metadata, lowered)
            if matched_value is None:
                continue
            self._record_match(
                best,
                node_id=node_id,
                score=SEARCH_SCORE_METADATA_VALUE,
                matched_text=f"{node_id} {matched_value}",
            )

    @staticmethod
    def _record_match(
        best: dict[str, SearchMatch],
        *,
        node_id: str,
        score: int,
        matched_text: str,
    ) -> None:
        existing = best.get(node_id)
        if existing is not None and existing.score >= score:
            return
        best[node_id] = SearchMatch(
            node_id=node_id,
            score=score,
            matched_text=matched_text,
        )

    def _node_coordinates(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: list[str],
    ) -> dict[str, tuple[float | None, float | None]]:
        """Global layout x/y for the given nodes, keyed by node id.

        Positions are frozen across LoD tiers, so a single row per node id
        (any tier) carries the canonical coordinates. Nodes without a stored
        position are simply absent from the result.
        """
        if not node_ids:
            return {}
        placeholders = ",".join("?" for _ in node_ids)
        rows = connection.execute(
            f"""
            select node_id, x, y
            from node_positions
            where dataset_id = ?
              and layout_version = ?
              and node_id in ({placeholders})
            """,
            (dataset_id, layout_version, *node_ids),
        ).fetchall()
        return {row["node_id"]: (row["x"], row["y"]) for row in rows}

    def _attach_node_metadata(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        nodes: tuple[ViewportNode, ...],
    ) -> tuple[ViewportNode, ...]:
        if not nodes:
            return nodes
        node_ids = {node.node_id for node in nodes if not node.is_representative}
        cluster_ids = {node.cluster_id for node in nodes if node.is_representative}
        node_metadata = self._load_metadata_rows(
            connection,
            table="node_metadata",
            key_column="node_id",
            dataset_id=dataset_id,
            layout_version=layout_version,
            keys=node_ids,
        )
        cluster_metadata = self._load_metadata_rows(
            connection,
            table="cluster_metadata",
            key_column="cluster_id",
            dataset_id=dataset_id,
            layout_version=layout_version,
            keys=cluster_ids,
        )
        enriched: list[ViewportNode] = []
        for node in nodes:
            metadata = (
                cluster_metadata.get(node.cluster_id)
                if node.is_representative
                else node_metadata.get(node.node_id)
            )
            enriched.append(replace(node, metadata=metadata) if metadata else node)
        return tuple(enriched)

    def _load_metadata_rows(
        self,
        connection: sqlite3.Connection,
        *,
        table: str,
        key_column: str,
        dataset_id: str,
        layout_version: str,
        keys: set[str],
    ) -> dict[str, MetadataMap]:
        if not keys:
            return {}
        placeholders = ",".join("?" for _ in keys)
        rows = connection.execute(
            f"""
            select {key_column} as row_key, metadata_json
            from {table}
            where dataset_id = ?
              and layout_version = ?
              and {key_column} in ({placeholders})
            """,
            (dataset_id, layout_version, *sorted(keys)),
        ).fetchall()
        return {row["row_key"]: json.loads(row["metadata_json"]) for row in rows}

    def _load_metadata_schema(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
    ) -> tuple[MetadataSchemaField, ...]:
        rows = connection.execute(
            """
            select field_key, field_type
            from metadata_schema
            where dataset_id = ? and layout_version = ?
            order by field_key
            """,
            (dataset_id, layout_version),
        ).fetchall()
        return tuple(
            MetadataSchemaField(key=row["field_key"], type=row["field_type"])
            for row in rows
        )

    def _read_lod_zero_without_bounds(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float | None,
        max_nodes: int,
    ) -> tuple[tuple[ViewportNode, ...], int, list[ViewportEdge]]:
        if threshold is not None:
            nodes = tuple(
                self._read_cluster_representatives(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    threshold=threshold,
                    xmin=None,
                    xmax=None,
                    ymin=None,
                    ymax=None,
                    max_nodes=max_nodes,
                )
            )
            total_node_count = self._count_clusters_for_threshold(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                threshold=threshold,
                xmin=None,
                xmax=None,
                ymin=None,
                ymax=None,
            )
            if total_node_count > 1:
                return (
                    nodes,
                    total_node_count,
                    self._read_prepared_edges_for_nodes(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        lod_level=0,
                        node_ids={node.node_id for node in nodes},
                    ),
                )

        nodes, total_node_count = self._read_distinct_node_positions(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            max_nodes=max_nodes,
        )
        return (
            tuple(nodes),
            total_node_count,
            self._read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids={node.node_id for node in nodes},
            ),
        )

    def _threshold_for_lod_level(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        lod_level: int | None,
    ) -> float | None:
        if lod_level is None:
            return None
        thresholds = self._cached_thresholds(
            connection, dataset_id=dataset_id, layout_version=layout_version
        )
        if not thresholds:
            return None
        index = min(max(lod_level, 0), len(thresholds) - 1)
        threshold = thresholds[index]
        min_threshold = thresholds[-1]
        return None if threshold == min_threshold else threshold

    def _cached_thresholds(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
    ) -> tuple[float, ...]:
        """Return distinct thresholds desc for a dataset, using the in-memory cache.

        The threshold list is immutable once a layout is prepared, so it is
        safe to cache for the lifetime of the store instance. The cache is
        evicted when ``clear_dataset`` is called for the dataset.
        """
        key = (dataset_id, layout_version)
        cached = self._threshold_cache.get(key)
        if cached is not None:
            return cached
        rows = connection.execute(
            """
            select distinct threshold
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold is not null
            order by threshold desc
            """,
            (dataset_id, layout_version),
        ).fetchall()
        result = tuple(row["threshold"] for row in rows)
        self._threshold_cache[key] = result
        return result

    def _read_ready_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        bounds_filter, bounds_params = optional_node_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        # The count and the row read share the same base-threshold join + bounds
        # filter, but are issued separately: a `count(*) over()` window would
        # force SQLite to materialize the full matched set (ignoring `limit`)
        # just to stamp the total on each returned row, which is the dominant
        # cost on deep-zoom slices. A bare `count(*)` scans the same index
        # without building or sorting the result set.
        count_params = (
            dataset_id,
            layout_version,
            dataset_id,
            layout_version,
            *bounds_params,
        )
        total_row = connection.execute(
            f"""
            with base_threshold as (
                select min(threshold) as value
                from prepared_clusters
                where dataset_id = ? and layout_version = ?
            )
            select count(*) as total_count
            from node_positions np
            join prepared_clusters pc
              on pc.dataset_id = np.dataset_id
             and pc.layout_version = np.layout_version
             and pc.cluster_id = np.cluster_id
            where np.dataset_id = ?
              and np.layout_version = ?
              and pc.threshold = (select value from base_threshold)
              {bounds_filter}
            """,
            count_params,
        ).fetchone()
        total = int(total_row["total_count"]) if total_row is not None else 0
        rows = connection.execute(
            f"""
            with base_threshold as (
                select min(threshold) as value
                from prepared_clusters
                where dataset_id = ? and layout_version = ?
            )
            select np.node_id, np.cluster_id, np.x, np.y, np.status
            from node_positions np
            join prepared_clusters pc
              on pc.dataset_id = np.dataset_id
             and pc.layout_version = np.layout_version
             and pc.cluster_id = np.cluster_id
            where np.dataset_id = ?
              and np.layout_version = ?
              and pc.threshold = (select value from base_threshold)
              {bounds_filter}
            order by np.cluster_id, np.node_id
            limit ?
            """,
            (*count_params, max_nodes),
        ).fetchall()
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                )
                for row in rows
            ],
            total,
        )

    def _read_cluster_member_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        cluster_id: str,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        # Separate count from row read: a `count(*) over()` window materializes
        # every member row before `limit`; a bare `count(*)` uses the
        # node_positions primary-key prefix (dataset, version, cluster) directly.
        total_row = connection.execute(
            """
            select count(*) as total_count
            from node_positions
            where dataset_id = ?
              and layout_version = ?
              and cluster_id = ?
            """,
            (dataset_id, layout_version, cluster_id),
        ).fetchone()
        total = int(total_row["total_count"]) if total_row is not None else 0
        rows = connection.execute(
            """
            select np.node_id, np.cluster_id, np.x, np.y, np.status
            from node_positions np
            where np.dataset_id = ?
              and np.layout_version = ?
              and np.cluster_id = ?
            order by np.node_id
            limit ?
            """,
            (dataset_id, layout_version, cluster_id, max_nodes),
        ).fetchall()
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                    is_representative=False,
                )
                for row in rows
            ],
            total,
        )

    def _read_expansion_meta_edges(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        cluster_id: str,
        member_ids: set[str],
    ) -> tuple[list[ViewportEdge], list[ViewportNode]]:
        """Reroute an expanded cluster's boundary edges to neighbor proxies.

        When a single cluster is expanded into its members, the members' edges
        to the rest of the tree would otherwise be dropped for referencing
        off-slice nodes. This resolves each such outside endpoint to the
        representative of the cluster it belongs to *at the same threshold* as
        the expanded cluster (the nearest visible representative), bundles the
        boundary edges by (member, neighbor representative) with the minimum
        boundary distance, and surfaces those neighbor representatives as nodes
        so every emitted meta-edge references a returned node.
        """
        if not member_ids:
            return [], []

        threshold_row = connection.execute(
            """
            select threshold
            from prepared_clusters
            where dataset_id = ? and layout_version = ? and cluster_id = ?
            """,
            (dataset_id, layout_version, cluster_id),
        ).fetchone()
        if threshold_row is None or threshold_row["threshold"] is None:
            return [], []
        threshold = threshold_row["threshold"]

        member_placeholders = ",".join("?" for _ in member_ids)
        sorted_members = sorted(member_ids)
        boundary_rows = connection.execute(
            f"""
            select edge_id, source_node_id, target_node_id, distance
            from graph_edges
            where dataset_id = ?
              and layout_version = ?
              and (source_node_id in ({member_placeholders})
                   or target_node_id in ({member_placeholders}))
            order by source_node_id, target_node_id, edge_id
            """,
            (dataset_id, layout_version, *sorted_members, *sorted_members),
        ).fetchall()

        # Keep only genuine boundary edges: exactly one endpoint is a member.
        boundary: list[tuple[str, str, float | None]] = []
        outside_ids: set[str] = set()
        for row in boundary_rows:
            source_inside = row["source_node_id"] in member_ids
            target_inside = row["target_node_id"] in member_ids
            if source_inside == target_inside:
                continue
            inside = row["source_node_id"] if source_inside else row["target_node_id"]
            outside = row["target_node_id"] if source_inside else row["source_node_id"]
            boundary.append((inside, outside, row["distance"]))
            outside_ids.add(outside)
        if not boundary:
            return [], []

        neighbor_reps = self._representatives_for_nodes(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            node_ids=outside_ids,
        )

        # Bundle boundary edges by (inside member, neighbor representative),
        # taking the minimum boundary distance and counting folded edges.
        bundled: dict[tuple[str, str], tuple[float | None, int]] = {}
        for inside, outside, distance in boundary:
            neighbor = neighbor_reps.get(outside)
            if neighbor is None:
                continue
            rep_id = neighbor.node_id
            # A self-loop can arise if the outside node resolves back to the
            # expanded cluster's own representative; skip it.
            if rep_id in member_ids:
                continue
            key = (inside, rep_id)
            existing = bundled.get(key)
            if existing is None:
                bundled[key] = (distance, 1)
                continue
            existing_distance, count = existing
            bundled[key] = (_min_distance(existing_distance, distance), count + 1)

        meta_edges = [
            ViewportEdge(
                edge_id=f"meta_edge:{inside}:{rep_id}",
                source=inside,
                target=rep_id,
                distance=distance,
                is_meta=True,
                bundled_edge_count=count,
            )
            for (inside, rep_id), (distance, count) in sorted(bundled.items())
        ]
        # Surface one node per distinct neighbor representative referenced by a
        # meta-edge. Several outside nodes can resolve to the same
        # representative, so deduplicate by representative node id.
        referenced_rep_ids = {rep_id for (_inside, rep_id) in bundled}
        surfaced_by_id: dict[str, ViewportNode] = {}
        for neighbor in neighbor_reps.values():
            if neighbor.node_id in referenced_rep_ids:
                surfaced_by_id.setdefault(neighbor.node_id, neighbor)
        surfaced_reps = [
            surfaced_by_id[rep_id] for rep_id in sorted(surfaced_by_id)
        ]
        return meta_edges, surfaced_reps

    def _representatives_for_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float,
        node_ids: set[str],
    ) -> dict[str, ViewportNode]:
        """Map each node id to its cluster representative at ``threshold``."""
        if not node_ids:
            return {}
        placeholders = ",".join("?" for _ in node_ids)
        rows = connection.execute(
            f"""
            select cm.node_id as node_id,
                   pc.cluster_id as cluster_id,
                   pc.representative_node_id as representative_node_id,
                   pc.member_count as member_count,
                   pc.x as x,
                   pc.y as y,
                   pc.status as status
            from cluster_members cm
            join prepared_clusters pc
              on pc.dataset_id = cm.dataset_id
             and pc.layout_version = cm.layout_version
             and pc.cluster_id = cm.cluster_id
            where cm.dataset_id = ?
              and cm.layout_version = ?
              and pc.threshold = ?
              and pc.x is not null
              and cm.node_id in ({placeholders})
            """,
            (dataset_id, layout_version, threshold, *sorted(node_ids)),
        ).fetchall()
        return {
            row["node_id"]: ViewportNode(
                node_id=row["representative_node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=row["member_count"],
                is_representative=True,
            )
            for row in rows
        }

    def _read_distinct_node_positions(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        # Count the distinct (node_id, x, y) groups without the window function,
        # which would otherwise materialize every grouped row before `limit`.
        total_row = connection.execute(
            """
            select count(*) as total_count
            from (
                select node_id, x, y
                from node_positions
                where dataset_id = ?
                  and layout_version = ?
                group by node_id, x, y
            )
            """,
            (dataset_id, layout_version),
        ).fetchone()
        total = int(total_row["total_count"]) if total_row is not None else 0
        rows = connection.execute(
            """
            select node_id,
                   min(cluster_id) as cluster_id,
                   x,
                   y,
                   max(status) as status
            from node_positions
            where dataset_id = ?
              and layout_version = ?
            group by node_id, x, y
            order by node_id
            limit ?
            """,
            (dataset_id, layout_version, max_nodes),
        ).fetchall()
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                )
                for row in rows
            ],
            total,
        )

    def _read_cluster_representatives(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
    ) -> list[ViewportNode]:
        bounds_filter, bounds_params = optional_cluster_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        rows = connection.execute(
            f"""
            select cluster_id, representative_node_id, x, y, member_count, status
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold = ?
              and x is not null
              {bounds_filter}
            order by member_count desc, cluster_id
            limit ?
            """,
            (
                dataset_id,
                layout_version,
                threshold,
                *bounds_params,
                max_nodes,
            ),
        ).fetchall()
        return [
            ViewportNode(
                node_id=row["representative_node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=row["member_count"],
                is_representative=True,
            )
            for row in rows
        ]

    def _count_clusters_for_threshold(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
    ) -> int:
        bounds_filter, bounds_params = optional_cluster_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        row = connection.execute(
            f"""
            select count(*) as total_count
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold = ?
              and x is not null
              {bounds_filter}
            """,
            (dataset_id, layout_version, threshold, *bounds_params),
        ).fetchone()
        return int(row["total_count"]) if row is not None else 0

    def _read_prepared_edges_for_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        lod_level: int,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        if not node_ids:
            return []
        # Both endpoints must be in ``node_ids``. Expressing that as two
        # ``in (<thousands of placeholders>)`` predicates makes SQLite
        # re-scan each list linearly for every candidate row, which is
        # O(rows * len(node_ids)) and reaches multiple seconds once a tier
        # has ~10k representatives. Loading the ids into an indexed temp
        # table and joining twice turns each endpoint check into a single
        # index probe, keeping the read in the low-millisecond range.
        connection.execute(
            "create temp table if not exists _viewport_node_ids("
            "node_id text primary key)"
        )
        try:
            connection.execute("delete from _viewport_node_ids")
            connection.executemany(
                "insert or ignore into _viewport_node_ids(node_id) values (?)",
                [(node_id,) for node_id in node_ids],
            )
            rows = connection.execute(
                """
                select e.edge_id, e.source_node_id, e.target_node_id, e.distance
                from prepared_edges e
                join _viewport_node_ids src on src.node_id = e.source_node_id
                join _viewport_node_ids tgt on tgt.node_id = e.target_node_id
                where e.dataset_id = ?
                  and e.layout_version = ?
                  and e.lod_level = ?
                order by e.source_node_id, e.target_node_id
                """,
                (dataset_id, layout_version, lod_level),
            ).fetchall()
        finally:
            connection.execute("delete from _viewport_node_ids")
        return [
            ViewportEdge(
                edge_id=row["edge_id"],
                source=row["source_node_id"],
                target=row["target_node_id"],
                distance=row["distance"],
            )
            for row in rows
        ]

    def _read_edges_for_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        params = [
            dataset_id,
            layout_version,
            *sorted(node_ids),
            *sorted(node_ids),
        ]
        rows = connection.execute(
            f"""
            select edge_id, source_node_id, target_node_id, distance
            from graph_edges
            where dataset_id = ?
              and layout_version = ?
              and source_node_id in ({placeholders})
              and target_node_id in ({placeholders})
            order by source_node_id, target_node_id, edge_id
            """,
            params,
        ).fetchall()
        return [
            ViewportEdge(
                edge_id=row["edge_id"],
                source=row["source_node_id"],
                target=row["target_node_id"],
                distance=row["distance"],
            )
            for row in rows
        ]

    def _read_edges_touching_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        """Edges with at least one endpoint in ``node_ids``.

        Unlike :meth:`_read_edges_for_nodes`, which requires both endpoints in
        the set, this keeps edges that straddle the viewport boundary so a
        bounds-filtered slice stays connected to its off-screen neighbors.
        """
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        params = [
            dataset_id,
            layout_version,
            *sorted(node_ids),
            *sorted(node_ids),
        ]
        rows = connection.execute(
            f"""
            select edge_id, source_node_id, target_node_id, distance
            from graph_edges
            where dataset_id = ?
              and layout_version = ?
              and (source_node_id in ({placeholders})
                   or target_node_id in ({placeholders}))
            order by source_node_id, target_node_id, edge_id
            """,
            params,
        ).fetchall()
        return [
            ViewportEdge(
                edge_id=row["edge_id"],
                source=row["source_node_id"],
                target=row["target_node_id"],
                distance=row["distance"],
            )
            for row in rows
        ]

    def _read_node_positions_by_ids(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
        max_nodes: int,
    ) -> list[ViewportNode]:
        """Fetch positions for specific node ids at the finest partition.

        Used to surface off-screen boundary-edge neighbors so the client keeps
        edges that cross the viewport edge. Capped by ``max_nodes`` so the
        connectivity aid never overruns the viewport node budget.
        """
        if not node_ids or max_nodes <= 0:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        rows = connection.execute(
            f"""
            with base_threshold as (
                select min(threshold) as value
                from prepared_clusters
                where dataset_id = ? and layout_version = ?
            )
            select np.node_id, np.cluster_id, np.x, np.y, np.status
            from node_positions np
            join prepared_clusters pc
              on pc.dataset_id = np.dataset_id
             and pc.layout_version = np.layout_version
             and pc.cluster_id = np.cluster_id
            where np.dataset_id = ?
              and np.layout_version = ?
              and pc.threshold = (select value from base_threshold)
              and np.node_id in ({placeholders})
            order by np.cluster_id, np.node_id
            limit ?
            """,
            (
                dataset_id,
                layout_version,
                dataset_id,
                layout_version,
                *sorted(node_ids),
                max_nodes,
            ),
        ).fetchall()
        return [
            ViewportNode(
                node_id=row["node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=1,
            )
            for row in rows
        ]

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        # WAL lets viewport readers proceed against the last committed snapshot
        # while a prepare write is in flight; NORMAL trades a fsync-per-commit
        # for the WAL checkpoint's durability, which is the right balance for a
        # rebuildable materialized-layout cache.
        connection.execute("pragma journal_mode=WAL")
        connection.execute("pragma synchronous=NORMAL")
        return connection

    def _table_exists(self, connection: sqlite3.Connection, table_name: str) -> bool:
        row = connection.execute(
            """
            select 1
            from sqlite_master
            where type = 'table' and name = ?
            """,
            (table_name,),
        ).fetchone()
        return row is not None

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                create table if not exists datasets(
                    dataset_id text not null,
                    layout_version text not null,
                    status text not null,
                    created_at text not null default current_timestamp,
                    updated_at text not null default current_timestamp,
                    primary key(dataset_id, layout_version)
                );

                create table if not exists prepared_clusters(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    threshold real,
                    representative_node_id text,
                    member_count integer not null default 0,
                    x real,
                    y real,
                    radius real,
                    min_x real,
                    max_x real,
                    min_y real,
                    max_y real,
                    status text not null,
                    primary key(dataset_id, layout_version, cluster_id)
                );

                create table if not exists cluster_members(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    node_id text not null,
                    primary key(dataset_id, layout_version, cluster_id, node_id)
                );

                create table if not exists graph_edges(
                    dataset_id text not null,
                    layout_version text not null,
                    edge_id text not null,
                    source_node_id text not null,
                    target_node_id text not null,
                    distance real,
                    primary key(dataset_id, layout_version, edge_id)
                );

                create table if not exists prepared_edges(
                    dataset_id text not null,
                    layout_version text not null,
                    lod_level integer not null,
                    edge_id text not null,
                    source_node_id text not null,
                    target_node_id text not null,
                    distance real,
                    primary key(dataset_id, layout_version, lod_level, edge_id)
                );

                create table if not exists node_positions(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    node_id text not null,
                    x real not null,
                    y real not null,
                    status text not null,
                    primary key(dataset_id, layout_version, cluster_id, node_id)
                );

                create table if not exists node_metadata(
                    dataset_id text not null,
                    layout_version text not null,
                    node_id text not null,
                    metadata_json text not null,
                    primary key(dataset_id, layout_version, node_id)
                );

                create table if not exists cluster_metadata(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    metadata_json text not null,
                    primary key(dataset_id, layout_version, cluster_id)
                );

                create table if not exists metadata_schema(
                    dataset_id text not null,
                    layout_version text not null,
                    field_key text not null,
                    field_type text not null,
                    primary key(dataset_id, layout_version, field_key)
                );

                create index if not exists idx_node_positions_xy
                on node_positions(dataset_id, layout_version, x, y);

                create index if not exists idx_graph_edges_endpoints
                on graph_edges(
                    dataset_id, layout_version, source_node_id, target_node_id
                );

                create index if not exists idx_prepared_edges_endpoints
                on prepared_edges(
                    dataset_id, layout_version, lod_level,
                    source_node_id, target_node_id
                );

                create index if not exists idx_prepared_clusters_bounds
                on prepared_clusters(
                    dataset_id, layout_version, min_x, max_x, min_y, max_y
                );

                create index if not exists idx_prepared_clusters_threshold
                on prepared_clusters(dataset_id, layout_version, threshold);

                create index if not exists idx_node_positions_cluster
                on node_positions(dataset_id, layout_version, cluster_id);

                create index if not exists idx_node_positions_node_id
                on node_positions(dataset_id, layout_version, node_id);

                create index if not exists idx_prepared_clusters_threshold_cluster
                on prepared_clusters(
                    dataset_id, layout_version, threshold, cluster_id
                );
                """
            )
