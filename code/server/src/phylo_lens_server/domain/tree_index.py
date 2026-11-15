from collections.abc import Iterable
from dataclasses import dataclass


def forest_adjacency(
    node_ids: Iterable[str],
    edges: Iterable[tuple[str, str, str]],
) -> dict[str, list[tuple[str, str]]]:
    """Validate endpoints and simple edges before indexing a canonical forest."""
    neighbors: dict[str, list[tuple[str, str]]] = {}
    for node_id in node_ids:
        if node_id in neighbors:
            raise ValueError("Tree nodes must have distinct IDs.")
        neighbors[node_id] = []
    if not neighbors:
        raise ValueError("A tree dataset requires at least one node.")
    pairs: set[frozenset[str]] = set()
    edge_ids: set[str] = set()
    for edge_id, source, target in edges:
        if edge_id in edge_ids:
            raise ValueError("Tree edges must have distinct IDs.")
        edge_ids.add(edge_id)
        if source not in neighbors or target not in neighbors:
            raise ValueError(f"Edge {edge_id} has an unknown endpoint.")
        pair = frozenset((source, target))
        if len(pair) != 2 or pair in pairs:
            raise ValueError("Tree edges must connect distinct nodes exactly once.")
        pairs.add(pair)
        neighbors[source].append((target, edge_id))
        neighbors[target].append((source, edge_id))
    return neighbors


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


def index_forest(
    neighbors: dict[str, list[tuple[str, str]]], roots: tuple[str, ...]
) -> tuple[TreeInterval, ...]:
    """Iterative DFS: O(N + E) time and O(N) space, including deep chains.

    Subtrees are contiguous and either nested or disjoint. Each root must orient
    exactly one component; parent links and distances are never inferred from geometry.
    """
    order: list[str] = []
    starts: dict[str, int] = {}
    entries: dict[str, TreeInterval] = {}
    for root in roots:
        if root not in neighbors or root in starts:
            raise ValueError(f"Invalid or repeated technical root: {root}.")
        stack = [(root, None, 0, False)]
        while stack:
            node, parent, depth, exiting = stack.pop()
            if exiting:
                entries[node] = TreeInterval(
                    node, root, parent, depth, starts[node], len(order)
                )
                continue
            if node in starts:
                raise ValueError("PhyloLens requires an acyclic tree or forest.")
            starts[node] = len(order)
            order.append(node)
            stack.append((node, parent, depth, True))
            for neighbor, _ in reversed(neighbors[node]):
                if neighbor != parent:
                    stack.append((neighbor, node, depth + 1, False))
    if len(order) != len(neighbors):
        raise ValueError("Every tree component requires one technical root.")
    return tuple(entries[node] for node in order)
