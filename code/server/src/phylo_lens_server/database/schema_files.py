from __future__ import annotations

from pathlib import Path
import sys

CREATE_SCHEMA_FILE = "create-schema.sql"


def read_schema_sql(dialect: str) -> str:
    return schema_file_path(dialect).read_text(encoding="utf-8")


def schema_file_path(dialect: str) -> Path:
    for root in schema_roots():
        path = root / dialect / CREATE_SCHEMA_FILE
        if path.is_file():
            return path
    roots = ", ".join(str(root) for root in schema_roots())
    raise FileNotFoundError(f"Could not find {dialect} schema under: {roots}")


def schema_roots() -> tuple[Path, ...]:
    server_root = Path(__file__).resolve().parents[3]
    package_target_root = Path(__file__).resolve().parents[2]
    return (
        server_root / "sql",
        package_target_root / "sql",
        Path(sys.prefix) / "sql",
    )
