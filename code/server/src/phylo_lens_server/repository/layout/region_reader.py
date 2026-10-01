from __future__ import annotations

from phylo_lens_server.pipeline.models import (
    RegionReadResult,
)
from phylo_lens_server.repository.layout.metadata_reader import (
    aggregate_layout_status,
    aggregate_render_metadata,
    attach_node_metadata,
    load_metadata_schema,
)
from phylo_lens_server.repository.layout.viewport_reader import (
    read_edges_for_nodes,
    read_ready_nodes,
)


def read_region(
    connection_context,
    *,
    dataset_id: str,
    layout_version: str,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    max_nodes: int | None = None,
    read_ready_nodes_fn=read_ready_nodes,
    read_edges_for_nodes_fn=None,
    attach_node_metadata_fn=attach_node_metadata,
    load_metadata_schema_fn=load_metadata_schema,
) -> RegionReadResult:
    if read_edges_for_nodes_fn is None:
        read_edges_for_nodes_fn = read_edges_for_nodes

    with connection_context as connection:
        ready_nodes, total_node_count = read_ready_nodes_fn(
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
        edges = read_edges_for_nodes_fn(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            node_ids=node_ids,
        )
        nodes = attach_node_metadata_fn(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
        )
        metadata_schema = load_metadata_schema_fn(
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
