"""Prepared component summaries and explicit component-scoped SQL sources."""

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.components import ComponentsReadResult, ComponentSummary


def component_source(
    table: str,
    component_id: str | None,
    *,
    alias: str | None = None,
    node_column: str = "node_id",
    placeholder: str = "?",
) -> tuple[str, tuple[str, ...]]:
    """Table and alias names are repository constants; identities stay bound values.

    The component index drives the join, rather than retrieving a forest and
    filtering its limited response. Bind this source's parameters before WHERE.
    """
    name = alias or table
    if component_id is None:
        return f"{table} {name}", ()
    return (
        f"""(select src.* from {table} src join node_tree_index ti
            on ti.dataset_id = src.dataset_id and ti.layout_version = src.layout_version
            and ti.node_id = src.{node_column}
            where ti.component_id = {placeholder}) {name}""",
        (component_id,),
    )


def materialize_components(
    connection: LayoutSQL, dataset_id: str, layout_version: str
) -> None:
    connection.execute(
        "delete from forest_components where dataset_id = ? and layout_version = ?",
        (dataset_id, layout_version),
    )
    connection.execute(
        """insert into forest_components(dataset_id, layout_version, component_id,
            node_count, dfs_start, min_x, max_x, min_y, max_y)
            select ti.dataset_id, ti.layout_version, ti.component_id,
                count(*), min(ti.dfs_start), min(np.x), max(np.x), min(np.y), max(np.y)
            from node_tree_index ti join node_positions np
                on np.dataset_id = ti.dataset_id and np.layout_version = ti.layout_version
                and np.node_id = ti.node_id
            where ti.dataset_id = ? and ti.layout_version = ?
            group by ti.dataset_id, ti.layout_version, ti.component_id""",
        (dataset_id, layout_version),
    )


def read_components(
    connection: LayoutSQL,
    *,
    dataset_id: str,
    layout_version: str,
    after: int | None = None,
    limit: int = 50,
) -> ComponentsReadResult:
    if not 1 <= limit <= 200 or (after is not None and after < 0):
        raise ValueError("Invalid component page.")
    published = connection.execute(
        "select 1 from datasets where dataset_id = ? and layout_version = ? and status in ('ready', 'degraded')",
        (dataset_id, layout_version),
    ).fetchone()
    if not published:
        raise KeyError((dataset_id, layout_version))
    rows = connection.execute(
        """select component_id, node_count, dfs_start, min_x, max_x, min_y, max_y
            from forest_components
            where dataset_id = ? and layout_version = ? and dfs_start > ?
            order by dfs_start limit ?""",
        (dataset_id, layout_version, -1 if after is None else after, limit + 1),
    ).fetchall()
    return ComponentsReadResult(
        dataset_id=dataset_id,
        layout_version=layout_version,
        components=tuple(ComponentSummary(**dict(row)) for row in rows[:limit]),
        next_cursor=rows[limit - 1]["dfs_start"] if len(rows) > limit else None,
    )
