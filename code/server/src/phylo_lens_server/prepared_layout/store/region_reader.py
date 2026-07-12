from __future__ import annotations

import sqlite3

from phylo_lens_server.prepared_layout.models import (
    RegionReadResult,
    ViewportEdge,
)
from phylo_lens_server.prepared_layout.store.metadata_reader import (
    aggregate_cluster_metadata,
    aggregate_layout_status,
    attach_node_metadata,
    load_metadata_schema,
)
from phylo_lens_server.prepared_layout.store.schema import connect

from phylo_lens_server.prepared_layout.store.viewport_reader import (
    read_ready_nodes,
)


def read_region(
    database_path,
    *,
    dataset_id: str,
    layout_version: str,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    max_nodes: int,
) -> RegionReadResult:
    with connect(database_path) as connection:
        ready_nodes, total_node_count = read_ready_nodes(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
        )
        nodes = tuple(ready_nodes)
        node_ids = {node.node_id for node in nodes}
        edges = _read_edges_for_nodes(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            node_ids=node_ids,
        )
        nodes = attach_node_metadata(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
        )
        metadata_schema = load_metadata_schema(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
        )

    aggregated_metadata = aggregate_cluster_metadata(
        [node.metadata or {} for node in nodes],
        tuple((field.key, field.type) for field in metadata_schema),
    )
    layout_status = aggregate_layout_status({node.layout_status for node in nodes})
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


def _read_edges_for_nodes(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: set[str],
) -> list[ViewportEdge]:
    if not node_ids:
        return []
    placeholders = ",".join("?" for _ in node_ids)
    params = [dataset_id, layout_version, *sorted(node_ids), *sorted(node_ids)]
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
