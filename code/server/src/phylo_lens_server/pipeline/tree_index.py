from phylo_lens_server.domain.tree_index import TreeInterval


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
                raise ValueError("LoD requires an acyclic tree or forest.")
            starts[node] = len(order)
            order.append(node)
            stack.append((node, parent, depth, True))
            for neighbor, _ in reversed(neighbors[node]):
                if neighbor != parent:
                    stack.append((neighbor, node, depth + 1, False))
    if len(order) != len(neighbors):
        raise ValueError("Every tree component requires one technical root.")
    return tuple(entries[node] for node in order)
