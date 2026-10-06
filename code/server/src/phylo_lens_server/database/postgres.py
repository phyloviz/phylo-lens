"""PostgreSQL connections and checksummed schema initialization."""

import hashlib
from dataclasses import dataclass

from .schema_files import read_schema_sql

POSTGRES_SCHEMA_VERSION = "rooted-hop-schema-v2"
POSTGRES_SCHEMA_VERSION_TABLE = "phylo_lens_schema_version"
ERR_POSTGRES_SCHEMA_NOT_CURRENT = "Postgres schema is not current. Run 'phylo-lens-init-postgres' before starting API replicas or workers."


@dataclass(frozen=True)
class PostgresSchema:
    version: str
    checksum: str
    sql: str


def import_psycopg():
    try:
        import psycopg
        import psycopg.rows
    except ImportError as error:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "Postgres prepare jobs require the 'postgres' extra: "
            "pip install 'phylo-lens-server[postgres]'."
        ) from error
    return psycopg


POSTGRES_CREATE_SCHEMA_SQL = read_schema_sql("postgres")


def postgres_schema() -> PostgresSchema:
    return PostgresSchema(
        version=POSTGRES_SCHEMA_VERSION,
        checksum=hashlib.sha256(POSTGRES_CREATE_SCHEMA_SQL.encode("utf-8")).hexdigest(),
        sql=POSTGRES_CREATE_SCHEMA_SQL,
    )


def sql_statements(sql: str) -> tuple[str, ...]:
    statements: list[str] = []
    start = 0
    index = 0
    in_dollar_quote = False
    while index < len(sql):
        if sql.startswith("$$", index):
            in_dollar_quote = not in_dollar_quote
            index += 2
            continue
        if sql[index] == ";" and not in_dollar_quote:
            statement = sql[start:index].strip()
            if statement:
                statements.append(statement)
            start = index + 1
        index += 1

    tail = sql[start:].strip()
    if tail:
        statements.append(tail)
    return tuple(statements)


def _ensure_schema_version_table(connection) -> None:
    connection.execute(
        f"""
        create table if not exists {POSTGRES_SCHEMA_VERSION_TABLE}(
            version text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
        )
        """
    )


def _schema_version_table_exists(connection) -> bool:
    row = connection.execute(
        "select to_regclass(%s) as schema_version_table",
        (POSTGRES_SCHEMA_VERSION_TABLE,),
    ).fetchone()
    return row is not None and row["schema_version_table"] is not None


def _read_schema_checksum(connection, version: str) -> str | None:
    row = connection.execute(
        f"select checksum from {POSTGRES_SCHEMA_VERSION_TABLE} where version = %s",
        (version,),
    ).fetchone()
    return None if row is None else row["checksum"]


def connect(dsn: str):
    psycopg = import_psycopg()
    return psycopg.connect(dsn, row_factory=psycopg.rows.dict_row)


def assert_schema_current(dsn: str) -> None:
    with connect(dsn) as connection:
        if not _schema_version_table_exists(connection):
            raise RuntimeError(ERR_POSTGRES_SCHEMA_NOT_CURRENT)
        schema = postgres_schema()
        applied_checksum = _read_schema_checksum(connection, schema.version)
        if applied_checksum != schema.checksum:
            raise RuntimeError(ERR_POSTGRES_SCHEMA_NOT_CURRENT)


def create_schema(dsn: str) -> None:
    with connect(dsn) as connection, connection.transaction():
        _ensure_schema_version_table(connection)
        schema = postgres_schema()
        applied_checksum = _read_schema_checksum(connection, schema.version)
        if applied_checksum == schema.checksum:
            return
        if applied_checksum is not None:
            raise RuntimeError(
                f"Postgres schema checksum mismatch for {schema.version}."
            )
        for statement in sql_statements(schema.sql):
            connection.execute(statement)
        connection.execute(
            f"""
                insert into {POSTGRES_SCHEMA_VERSION_TABLE}(
                    version, checksum
                ) values (%s, %s)
                """,
            (schema.version, schema.checksum),
        )
