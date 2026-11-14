from types import MappingProxyType

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.connections import ConnectionContext
from phylo_lens_server.domain.models import GraphEdge


def read_connection_context(
    sql: LayoutSQL, dataset_id: str, layout_version: str
) -> ConnectionContext:
    ready = sql.execute(
        "select 1 from datasets where dataset_id = ? and layout_version = ? and status in ('ready', 'degraded')",
        (dataset_id, layout_version),
    ).fetchone()
    if ready is None:
        raise KeyError("The prepared layout is not available.")
    owners = {
        row["node_id"]: row["component_id"]
        for row in sql.execute(
            "select node_id, component_id from node_tree_index where dataset_id = ? and layout_version = ?",
            (dataset_id, layout_version),
        ).fetchall()
    }
    edges = tuple(
        GraphEdge(
            id=row["edge_id"],
            source=row["source_node_id"],
            target=row["target_node_id"],
            distance=row["distance"],
        )
        for row in sql.execute(
            "select edge_id, source_node_id, target_node_id, distance from graph_edges where dataset_id = ? and layout_version = ?",
            (dataset_id, layout_version),
        ).fetchall()
    )
    if not owners:
        raise KeyError("This layout has no forest index; load the dataset again.")
    return ConnectionContext(MappingProxyType(owners), edges)
