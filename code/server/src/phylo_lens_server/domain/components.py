"""Immutable summaries for paged navigation through a prepared forest."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ComponentSummary:
    component_id: str
    node_count: int
    dfs_start: int
    min_x: float
    max_x: float
    min_y: float
    max_y: float


@dataclass(frozen=True)
class ComponentsReadResult:
    dataset_id: str
    layout_version: str
    components: tuple[ComponentSummary, ...]
    next_cursor: int | None
