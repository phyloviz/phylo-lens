"""Small DB-API dialect adapter for the fixed layout queries.

Only parameter markers and bulk execution differ. SQL, transactions and graph
retrieval remain explicit in repositories; this is not a repository framework.
"""

from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

SQLParameters = Sequence[object]
SQLRow = Mapping[str, object]


class Cursor(Protocol):
    def fetchone(self) -> SQLRow | None: ...
    def fetchall(self) -> list[SQLRow]: ...
    def __iter__(self) -> Iterator[SQLRow]: ...
    def executemany(self, sql: str, rows: Iterable[SQLParameters]) -> object: ...
    def close(self) -> None: ...


class Connection(Protocol):
    def execute(self, sql: str, parameters: SQLParameters = ()) -> Cursor: ...
    def cursor(self) -> Cursor: ...


@dataclass(frozen=True)
class LayoutSQL:
    connection: Connection
    backend: Literal["sqlite", "postgres"] = "sqlite"

    def execute(self, sql: str, parameters: SQLParameters = ()) -> Cursor:
        return self.connection.execute(self.render(sql), parameters)

    def executemany(self, sql: str, rows: Iterable[SQLParameters]) -> None:
        cursor = self.connection.cursor()
        try:
            cursor.executemany(self.render(sql), rows)
        finally:
            cursor.close()

    def render(self, sql: str) -> str:
        # Statements are fixed repository SQL; markers never appear in literals.
        return sql if self.backend == "sqlite" else sql.replace("?", "%s")

    def membership(
        self, column: str, identifiers: Iterable[str]
    ) -> tuple[str, tuple[object, ...]]:
        ids = sorted(identifiers)
        if self.backend == "postgres":
            return f"{column} = any(?)", (ids,)
        return f"{column} in ({','.join('?' for _ in ids)})", tuple(ids)
