from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Any

from .paths import bootstrap_server_src

bootstrap_server_src()

from phylo_lens_server.repository.layout.sqlite_layout_repository import (  # noqa: E402
    PreparedLayoutStore,
)


@dataclass(frozen=True)
class Bounds:
    xmin: float
    xmax: float
    ymin: float
    ymax: float


def dataset_bounds(
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
) -> Bounds:
    with sqlite3.connect(store.path) as connection:
        row = connection.execute(
            """
            select min(x), max(x), min(y), max(y)
            from node_positions
            where dataset_id = ? and layout_version = ?
            """,
            (dataset_id, layout_version),
        ).fetchone()
    if row is None or row[0] is None:
        return Bounds(0.0, 0.0, 0.0, 0.0)
    return Bounds(float(row[0]), float(row[1]), float(row[2]), float(row[3]))


def centered_bounds(full: Bounds, fraction: float) -> Bounds:
    clamped = min(max(fraction, 0.000001), 1.0)
    width = max(full.xmax - full.xmin, 1.0)
    height = max(full.ymax - full.ymin, 1.0)
    center_x = (full.xmin + full.xmax) / 2.0
    center_y = (full.ymin + full.ymax) / 2.0
    half_width = width * clamped / 2.0
    half_height = height * clamped / 2.0
    return Bounds(
        xmin=center_x - half_width,
        xmax=center_x + half_width,
        ymin=center_y - half_height,
        ymax=center_y + half_height,
    )


def materialized_size_bytes(path: Path) -> int:
    total = 0
    for candidate in (
        path,
        path.with_name(path.name + "-wal"),
        path.with_name(path.name + "-shm"),
    ):
        if candidate.exists():
            total += candidate.stat().st_size
    return total


def thresholds(
    store: PreparedLayoutStore,
    dataset_id: str,
    layout_version: str,
) -> tuple[float, ...]:
    with sqlite3.connect(store.path) as connection:
        rows = connection.execute(
            """
            select distinct threshold
            from prepared_clusters
            where dataset_id = ? and layout_version = ? and threshold is not null
            order by threshold desc
            """,
            (dataset_id, layout_version),
        ).fetchall()
    return tuple(float(row[0]) for row in rows)


def query_plan_events(
    store: PreparedLayoutStore,
    *,
    dataset_id: str,
    layout_version: str,
    threshold: float | None,
    bounds: Bounds,
    limit: int,
) -> list[tuple[str, list[str]]]:
    plans: list[tuple[str, list[str]]] = []
    with sqlite3.connect(store.path) as connection:
        connection.row_factory = sqlite3.Row
        plans.append(
            (
                "ready_nodes_bounds",
                explain(
                    connection,
                    """
                    select np.node_id, np.cluster_id, np.x, np.y, np.status
                    from node_positions np
                    where np.dataset_id = ?
                      and np.layout_version = ?
                      and np.x between ? and ?
                      and np.y between ? and ?
                    order by np.cluster_id, np.node_id
                    limit ?
                    """,
                    (
                        dataset_id,
                        layout_version,
                        bounds.xmin,
                        bounds.xmax,
                        bounds.ymin,
                        bounds.ymax,
                        limit,
                    ),
                ),
            )
        )
        if threshold is not None:
            plans.append(
                (
                    "cluster_representatives_bounds",
                    explain(
                        connection,
                        """
                        select cluster_id, representative_node_id, x, y, member_count, status
                        from prepared_clusters
                        where dataset_id = ?
                          and layout_version = ?
                          and threshold = ?
                          and x is not null
                          and max_x >= ?
                          and min_x <= ?
                          and max_y >= ?
                          and min_y <= ?
                        order by member_count desc, cluster_id
                        limit ?
                        """,
                        (
                            dataset_id,
                            layout_version,
                            threshold,
                            bounds.xmin,
                            bounds.xmax,
                            bounds.ymin,
                            bounds.ymax,
                            limit,
                        ),
                    ),
                )
            )
    return plans


def explain(
    connection: sqlite3.Connection,
    sql: str,
    params: tuple[Any, ...],
) -> list[str]:
    rows = connection.execute(f"explain query plan {sql}", params).fetchall()
    return [str(row["detail"]) for row in rows]
