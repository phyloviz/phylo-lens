from __future__ import annotations

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.summaries import (
    aggregate_layout_status,
    aggregate_render_metadata,
)
from phylo_lens_server.domain.views import RegionReadResult
from phylo_lens_server.repository.layout.metadata_reader import (
    attach_node_metadata,
    load_metadata_schema,
)
from phylo_lens_server.repository.layout.viewport_reader import (
    read_edges_for_nodes,
    read_positioned_nodes,
)


def read_region(
    connection: LayoutSQL,
    *,
    dataset_id: str,
    layout_version: str,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    max_nodes: int | None = None,
) -> RegionReadResult:
    ready_nodes, total_node_count = read_positioned_nodes(
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
    edges = read_edges_for_nodes(
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

    aggregated_metadata = aggregate_render_metadata(
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
        truncated=max_nodes is not None and total_node_count > len(nodes),
        layout_status=layout_status,
        metadata_schema=metadata_schema,
        aggregated_metadata=aggregated_metadata,
    )
