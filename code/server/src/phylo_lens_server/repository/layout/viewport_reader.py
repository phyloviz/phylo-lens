from __future__ import annotations

import sqlite3

from phylo_lens_server.pipeline.models import (
    LayoutBounds,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)
from phylo_lens_server.repository.layout.metadata_reader import (
    aggregate_layout_status,
    attach_node_metadata,
    load_metadata_schema,
)
from phylo_lens_server.database.sqlite import connect


def has_bounds(
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> bool:
    return None not in (xmin, xmax, ymin, ymax)


def optional_node_bounds_filter(
    *,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> tuple[str, tuple[float | None, ...]]:
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
) -> tuple[str, tuple[float | None, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and max_x >= ? and min_x <= ? and max_y >= ? and min_y <= ?", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def read_viewport(
    database_path,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
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
    focus_node_id: str | None = None,
) -> ViewportReadResult:
    nodes: tuple[ViewportNode, ...] = ()
    edges: tuple[ViewportEdge, ...] = ()
    with connect(database_path) as connection:
        global_bounds = _read_global_node_bounds(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
        )
        if cluster_id:
            nodes, total_node_count = _read_cluster_member_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=cluster_id,
                max_nodes=max_nodes,
                focus_node_id=focus_node_id,
            )
            member_ids = {node.node_id for node in nodes}
            edges = tuple(
                _read_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=member_ids,
                )
            )
            meta_edges, neighbor_reps = _read_expansion_meta_edges(
                connection,
                threshold_cache,
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=cluster_id,
                member_ids=member_ids,
            )
            nodes = tuple(nodes) + tuple(neighbor_reps)
            edges = edges + tuple(meta_edges)
            layout_status = aggregate_layout_status(
                {node.layout_status for node in nodes}
            )
            enriched = attach_node_metadata(
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
                global_bounds=global_bounds,
                metadata_schema=load_metadata_schema(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                ),
            )

        threshold = _threshold_for_lod_level(
            connection,
            threshold_cache,
            dataset_id=dataset_id,
            layout_version=layout_version,
            lod_level=lod_level,
        )
        if lod_level == 0 and not has_bounds(xmin, xmax, ymin, ymax):
            nodes, total_node_count, edges = _read_lod_zero_without_bounds(
                connection,
                threshold_cache,
                dataset_id=dataset_id,
                layout_version=layout_version,
                threshold=threshold,
                max_nodes=max_nodes,
            )
        elif threshold is None:
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
            viewport_node_ids = {node.node_id for node in nodes}
            edges = tuple(
                _read_edges_touching_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=viewport_node_ids,
                )
            )
            neighbor_ids = {
                endpoint
                for edge in edges
                for endpoint in (edge.source, edge.target)
                if endpoint not in viewport_node_ids
            }
            neighbors = tuple(
                _read_node_positions_by_ids(
                    connection,
                    threshold_cache,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=neighbor_ids,
                    max_nodes=len(neighbor_ids),
                )
                if neighbor_ids
                else ()
            )
            nodes = nodes + neighbors
            present_ids = viewport_node_ids | {node.node_id for node in neighbors}
            edges = tuple(
                edge
                for edge in edges
                if edge.source in present_ids and edge.target in present_ids
            )
            total_node_count += len(neighbors)
        else:
            nodes = tuple(
                _read_cluster_representatives(
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
            total_node_count = _count_clusters_for_threshold(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                threshold=threshold,
                xmin=xmin,
                xmax=xmax,
                ymin=ymin,
                ymax=ymax,
            )
            edges = tuple(
                _read_prepared_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    lod_level=lod_level or 0,
                    node_ids={node.node_id for node in nodes},
                )
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

    layout_status = aggregate_layout_status({node.layout_status for node in nodes})
    return ViewportReadResult(
        dataset_id=dataset_id,
        layout_version=layout_version,
        nodes=nodes,
        edges=tuple(edges),
        total_node_count=total_node_count,
        truncated=total_node_count > len(nodes),
        layout_status=layout_status,
        global_bounds=global_bounds,
        metadata_schema=metadata_schema,
    )


def _read_global_node_bounds(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
) -> LayoutBounds | None:
    row = connection.execute(
        """
        select min(x) as min_x, max(x) as max_x, min(y) as min_y, max(y) as max_y
        from node_positions
        where dataset_id = ?
          and layout_version = ?
        """,
        (dataset_id, layout_version),
    ).fetchone()
    if row is None or row["min_x"] is None:
        return None
    return LayoutBounds(
        min_x=row["min_x"],
        max_x=row["max_x"],
        min_y=row["min_y"],
        max_y=row["max_y"],
    )


def _threshold_for_lod_level(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
    lod_level: int | None,
) -> float | None:
    if lod_level is None:
        return None
    thresholds = _cached_thresholds(
        connection,
        threshold_cache,
        dataset_id=dataset_id,
        layout_version=layout_version,
    )
    if not thresholds:
        return None
    index = min(max(lod_level, 0), len(thresholds) - 1)
    threshold = thresholds[index]
    min_threshold = thresholds[-1]
    return None if threshold == min_threshold else threshold


def _cached_thresholds(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
) -> tuple[float, ...]:
    key = (dataset_id, layout_version)
    cached = threshold_cache.get(key)
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
    threshold_cache[key] = result
    return result


def _read_lod_zero_without_bounds(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
    threshold: float | None,
    max_nodes: int,
) -> tuple[tuple[ViewportNode, ...], int, tuple[ViewportEdge, ...]]:
    if threshold is not None:
        nodes = tuple(
            _read_cluster_representatives(
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
        total_node_count = _count_clusters_for_threshold(
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
                tuple(
                    _read_prepared_edges_for_nodes(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        lod_level=0,
                        node_ids={node.node_id for node in nodes},
                    )
                ),
            )

    nodes, total_node_count = _read_distinct_node_positions(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        max_nodes=max_nodes,
    )
    return (
        tuple(nodes),
        total_node_count,
        tuple(
            _read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids={node.node_id for node in nodes},
            )
        ),
    )


def read_ready_nodes(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
    max_nodes: int,
) -> tuple[tuple[ViewportNode, ...], int]:
    bounds_filter, bounds_params = optional_node_bounds_filter(
        xmin=xmin,
        xmax=xmax,
        ymin=ymin,
        ymax=ymax,
    )
    count_params = (dataset_id, layout_version, *bounds_params)
    total_row = connection.execute(
        f"""
        select count(*) as total_count
        from node_positions np
        where np.dataset_id = ?
          and np.layout_version = ?
          {bounds_filter}
        """,
        count_params,
    ).fetchone()
    total = int(total_row["total_count"]) if total_row is not None else 0
    rows = connection.execute(
        f"""
        select np.node_id, np.cluster_id, np.x, np.y, np.status
        from node_positions np
        where np.dataset_id = ?
          and np.layout_version = ?
          {bounds_filter}
        order by np.cluster_id, np.node_id
        limit ?
        """,
        (*count_params, max_nodes),
    ).fetchall()
    return (
        tuple(
            ViewportNode(
                node_id=row["node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=1,
            )
            for row in rows
        ),
        total,
    )


def _read_cluster_member_nodes(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    cluster_id: str,
    max_nodes: int,
    focus_node_id: str | None = None,
) -> tuple[tuple[ViewportNode, ...], int]:
    total_row = connection.execute(
        """
        select count(*) as total_count
        from cluster_members
        where dataset_id = ?
          and layout_version = ?
          and cluster_id = ?
        """,
        (dataset_id, layout_version, cluster_id),
    ).fetchone()
    total = int(total_row["total_count"]) if total_row is not None else 0
    rows = connection.execute(
        """
        select cm.node_id, cm.cluster_id, np.x, np.y, np.status
        from cluster_members cm
        join node_positions np
          on np.dataset_id = cm.dataset_id
         and np.layout_version = cm.layout_version
         and np.node_id = cm.node_id
        where cm.dataset_id = ?
          and cm.layout_version = ?
          and cm.cluster_id = ?
        order by case when np.node_id = ? then 0 else 1 end, np.node_id
        limit ?
        """,
        (dataset_id, layout_version, cluster_id, focus_node_id, max_nodes),
    ).fetchall()
    return (
        tuple(
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
        ),
        total,
    )


def _read_expansion_meta_edges(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
    cluster_id: str,
    member_ids: set[str],
) -> tuple[list[ViewportEdge], list[ViewportNode]]:
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

    neighbor_reps = _representatives_for_nodes(
        connection,
        threshold_cache,
        dataset_id=dataset_id,
        layout_version=layout_version,
        threshold=threshold,
        node_ids=outside_ids,
    )

    bundled: dict[tuple[str, str], tuple[float | None, int]] = {}
    for inside, outside, distance in boundary:
        neighbor = neighbor_reps.get(outside)
        if neighbor is None:
            continue
        rep_id = neighbor.node_id
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
    referenced_rep_ids = {rep_id for (_inside, rep_id) in bundled}
    surfaced_by_id: dict[str, ViewportNode] = {}
    for neighbor in neighbor_reps.values():
        if neighbor.node_id in referenced_rep_ids:
            surfaced_by_id.setdefault(neighbor.node_id, neighbor)
    surfaced_reps = [surfaced_by_id[rep_id] for rep_id in sorted(surfaced_by_id)]
    return meta_edges, surfaced_reps


def _representatives_for_nodes(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
    threshold: float,
    node_ids: set[str],
) -> dict[str, ViewportNode]:
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
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    max_nodes: int,
) -> tuple[tuple[ViewportNode, ...], int]:
    total_row = connection.execute(
        """
        select count(*) as total_count
        from node_positions
        where dataset_id = ?
          and layout_version = ?
        """,
        (dataset_id, layout_version),
    ).fetchone()
    total = int(total_row["total_count"]) if total_row is not None else 0
    rows = connection.execute(
        """
        select node_id, cluster_id, x, y, status
        from node_positions
        where dataset_id = ?
          and layout_version = ?
        order by node_id
        limit ?
        """,
        (dataset_id, layout_version, max_nodes),
    ).fetchall()
    return (
        tuple(
            ViewportNode(
                node_id=row["node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=1,
            )
            for row in rows
        ),
        total,
    )


def _read_cluster_representatives(
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
) -> tuple[ViewportNode, ...]:
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
    return tuple(
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
    )


def _count_clusters_for_threshold(
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
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    lod_level: int,
    node_ids: set[str],
) -> tuple[ViewportEdge, ...]:
    if not node_ids:
        return ()
    connection.execute(
        "create temp table if not exists _viewport_node_ids(node_id text primary key)"
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
    return tuple(
        ViewportEdge(
            edge_id=row["edge_id"],
            source=row["source_node_id"],
            target=row["target_node_id"],
            distance=row["distance"],
        )
        for row in rows
    )


def _read_edges_for_nodes(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: set[str],
) -> tuple[ViewportEdge, ...]:
    if not node_ids:
        return ()
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
    return tuple(
        ViewportEdge(
            edge_id=row["edge_id"],
            source=row["source_node_id"],
            target=row["target_node_id"],
            distance=row["distance"],
        )
        for row in rows
    )


def _read_edges_touching_nodes(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: set[str],
) -> tuple[ViewportEdge, ...]:
    if not node_ids:
        return ()
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
    return tuple(
        ViewportEdge(
            edge_id=row["edge_id"],
            source=row["source_node_id"],
            target=row["target_node_id"],
            distance=row["distance"],
        )
        for row in rows
    )


def _read_node_positions_by_ids(
    connection: sqlite3.Connection,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: set[str],
    max_nodes: int,
) -> list[ViewportNode]:
    if not node_ids or max_nodes <= 0:
        return []
    placeholders = ",".join("?" for _ in node_ids)
    rows = connection.execute(
        f"""
        select np.node_id, np.cluster_id, np.x, np.y, np.status
        from node_positions np
        where np.dataset_id = ?
          and np.layout_version = ?
          and np.node_id in ({placeholders})
        order by np.cluster_id, np.node_id
        limit ?
        """,
        (
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


def _min_distance(left: float | None, right: float | None) -> float | None:
    if left is None:
        return right
    if right is None:
        return left
    return left if left <= right else right
