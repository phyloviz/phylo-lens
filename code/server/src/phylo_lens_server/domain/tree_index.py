from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TreeInterval:
    """Half-open DFS interval in one immutable prepared forest."""

    node_id: str
    component_id: str
    parent_id: str | None
    depth: int
    start: int
    end: int

    @property
    def size(self) -> int:
        return self.end - self.start
