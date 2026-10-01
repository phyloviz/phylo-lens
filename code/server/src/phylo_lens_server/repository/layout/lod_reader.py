"""Spatial representation counts for viewport-aware selection on both stores."""


def read_viewport_representation_counts(
    connection,
    *,
    dataset_id: str,
    layout_version: str,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
    placeholder: str,
    max_lod_level: int | None = None,
) -> dict[int, int]:
    bounded = xmin is not None
    params = (dataset_id, layout_version)
    cluster_bounds = (
        f"and max_x >= {placeholder} and min_x <= {placeholder} and max_y >= {placeholder} and min_y <= {placeholder}"
        if bounded
        else ""
    )
    cluster_params = (xmin, xmax, ymin, ymax) if bounded else ()
    ceiling_clause = (
        f"and lod_level <= {placeholder}" if max_lod_level is not None else ""
    )
    ceiling_params = (max_lod_level,) if max_lod_level is not None else ()
    rows = connection.execute(
        f"""
        select lod_level,
               sum(case when x is not null {cluster_bounds} then 1 else 0 end) as visible_count
        from prepared_clusters
        where dataset_id = {placeholder} and layout_version = {placeholder}
        {ceiling_clause}
        group by lod_level
        having count(x) = count(*)
        order by lod_level
        """,
        (*cluster_params, *params, *ceiling_params),
    ).fetchall()
    counts = {int(row["lod_level"]): int(row["visible_count"]) for row in rows}
    finest_row = connection.execute(
        f"select max(lod_level) as finest_level from prepared_clusters where dataset_id = {placeholder} and layout_version = {placeholder}",
        params,
    ).fetchone()
    finest = finest_row["finest_level"] if finest_row else None
    if finest is None or finest not in counts:
        return counts
    node_bounds = (
        f"and x between {placeholder} and {placeholder} and y between {placeholder} and {placeholder}"
        if bounded
        else ""
    )
    # Detail retrieval surfaces all one-hop neighbors. Count that exact union,
    # so a star's off-screen children cannot masquerade as a cheap fine tier.
    row = connection.execute(
        f"""
        with visible as (
            select node_id from node_positions
            where dataset_id = {placeholder} and layout_version = {placeholder}
            {node_bounds}
        ), represented as (
            select node_id from visible
            union
            select e.target_node_id from graph_edges e
            join visible v on v.node_id = e.source_node_id
            where e.dataset_id = {placeholder} and e.layout_version = {placeholder}
            union
            select e.source_node_id from graph_edges e
            join visible v on v.node_id = e.target_node_id
            where e.dataset_id = {placeholder} and e.layout_version = {placeholder}
        )
        select count(*) as visible_count from represented r
        join node_positions np on np.node_id = r.node_id
        where np.dataset_id = {placeholder} and np.layout_version = {placeholder}
        """,
        (*params, *cluster_params, *params, *params, *params),
    ).fetchone()
    counts[int(finest)] = int(row["visible_count"])
    return counts
