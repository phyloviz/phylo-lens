import sqlite3

from phylo_lens_server.database.postgres import postgres_schema
from phylo_lens_server.database.sqlite import initialize_schema


def test_sqlite_fresh_cluster_schema_has_only_lod_level(tmp_path) -> None:
    path = tmp_path / "fresh.sqlite3"
    initialize_schema(path)
    with sqlite3.connect(path) as connection:
        columns = {
            row[1]: row
            for row in connection.execute("pragma table_info(prepared_clusters)")
        }
        indexes = {
            row[1] for row in connection.execute("pragma index_list(prepared_clusters)")
        }
    assert "lod_level" in columns
    assert columns["lod_level"][3] == 1
    assert "hop_depth" not in columns
    assert "idx_prepared_clusters_hop_bounds" in indexes


def test_postgres_schema_declares_lod_level_without_legacy_migration() -> None:
    sql = postgres_schema().sql
    assert "lod_level integer not null" in sql
    assert "hop_depth integer" not in sql
    assert "alter table prepared_clusters add column" not in sql
    assert "idx_prepared_clusters_hop_bounds" in sql
