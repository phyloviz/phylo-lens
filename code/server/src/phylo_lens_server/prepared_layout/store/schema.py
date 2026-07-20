from __future__ import annotations

from pathlib import Path
import sqlite3

DEFAULT_DB_NAME = "prepared_layout.sqlite3"


def database_path_for_root(root: Path | str) -> Path:
    return Path(root) / DEFAULT_DB_NAME


def connect(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma journal_mode=WAL")
    connection.execute("pragma synchronous=NORMAL")
    return connection


def table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        """
        select 1
        from sqlite_master
        where type = 'table' and name = ?
        """,
        (table_name,),
    ).fetchone()
    return row is not None


def initialize_schema(database_path: Path) -> None:
    with connect(database_path) as connection:
        connection.executescript("""
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

            create table if not exists metadata_schema(
                dataset_id text not null,
                layout_version text not null,
                field_key text not null,
                field_type text not null,
                primary key(dataset_id, layout_version, field_key)
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

            create index if not exists idx_node_positions_node_id
                on node_positions(dataset_id, layout_version, node_id);
            create index if not exists idx_node_positions_cluster_id
                on node_positions(dataset_id, layout_version, cluster_id);
            create index if not exists idx_node_positions_xy
                on node_positions(dataset_id, layout_version, x, y);
            create index if not exists idx_prepared_clusters_threshold
                on prepared_clusters(dataset_id, layout_version, threshold);
            create index if not exists idx_prepared_clusters_bounds
                on prepared_clusters(
                    dataset_id, layout_version, threshold, max_x, min_x, max_y, min_y
                );
            create index if not exists idx_prepared_edges_lod
                on prepared_edges(dataset_id, layout_version, lod_level);
            create index if not exists idx_prepared_edges_endpoints
                on prepared_edges(
                    dataset_id, layout_version, lod_level,
                    source_node_id, target_node_id
                );
            create index if not exists idx_graph_edges_endpoints
                on graph_edges(dataset_id, layout_version, source_node_id, target_node_id);
            create index if not exists idx_graph_edges_target_endpoints
                on graph_edges(dataset_id, layout_version, target_node_id, source_node_id);
            create index if not exists idx_node_metadata_json
                on node_metadata(dataset_id, layout_version, metadata_json);
            create index if not exists idx_cluster_metadata_json
                on cluster_metadata(dataset_id, layout_version, metadata_json);
            """)
