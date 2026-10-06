from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.preparation import ClusterLayout, NodeLayoutPosition
from phylo_lens_server.domain.views import LayoutBounds


def load_cluster_layouts(
    connection: LayoutSQL,
    dataset_id: str,
    layout_version: str,
) -> list[ClusterLayout]:
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
    connection: LayoutSQL,
    dataset_id: str,
    layout_version: str,
) -> list[NodeLayoutPosition]:
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
