from __future__ import annotations

from pathlib import Path
import sqlite3

from phylo_lens_server.database.schema_files import read_schema_sql

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
        connection.executescript(read_schema_sql("sqlite"))
