"""Rooted hop cuts for pendant-subtree levels of detail."""

from __future__ import annotations

from collections import deque

from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.models import PreparedCluster

MAX_LOD_LEVELS = 12
Adjacency = dict[str, list[tuple[str, str]]]


def tree_adjacency(dataset: CanonicalDataset) -> Adjacency:
    neighbors: Adjacency = {node.id: [] for node in dataset.nodes}
    if len(neighbors) != len(dataset.nodes):
        raise ValueError("Tree nodes must have distinct IDs.")
    pairs: set[frozenset[str]] = set()
    for edge in dataset.edges:
        if edge.source not in neighbors or edge.target not in neighbors:
            raise ValueError(f"Edge {edge.id} has an unknown endpoint.")
        pair = frozenset((edge.source, edge.target))
        if len(pair) != 2 or pair in pairs:
            raise ValueError("Tree edges must connect distinct nodes exactly once.")
        pairs.add(pair)
        neighbors[edge.source].append((edge.target, edge.id))
        neighbors[edge.target].append((edge.source, edge.id))
    for links in neighbors.values():
        links.sort()
    return neighbors


def rooted_depths(neighbors: Adjacency, roots: tuple[str, ...]) -> dict[str, int]:
    """Orient each tree component; reject cycles and missing/duplicate roots."""
    depths: dict[str, int] = {}
    for root in roots:
        if root not in neighbors or root in depths:
            raise ValueError(f"Invalid or repeated technical root: {root}.")
        depths[root] = 0
        queue = deque([(root, None)])
        while queue:
            node, parent = queue.popleft()
            for neighbor, _ in neighbors[node]:
                if neighbor == parent:
                    continue
                if neighbor in depths:
                    raise ValueError("LoD requires an acyclic tree or forest.")
                depths[neighbor] = depths[node] + 1
                queue.append((neighbor, node))
    if len(depths) != len(neighbors):
        raise ValueError("Every tree component requires one technical root.")
    return depths


def selected_depths(
    max_depth: int, max_levels: int = MAX_LOD_LEVELS
) -> tuple[int, ...]:
    """Choose a bounded set of cuts independently of cluster membership."""
    if max_levels < 1:
        raise ValueError("At least one LoD level is required.")
    if max_depth < 0:
        raise ValueError("Tree depth cannot be negative.")
    if max_depth == 0 or max_levels == 1:
        return (max_depth,)
    cuts = [0]
    depth = 1
    while depth < max_depth and len(cuts) < max_levels - 1:
        cuts.append(depth)
        depth *= 2
    cuts.append(max_depth)
    return tuple(cuts)


def clusters_at_depth(
    neighbors: Adjacency,
    depths: dict[str, int],
    hop_depth: int,
    lod_level: int,
) -> tuple[PreparedCluster, ...]:
    """Keep the rooted prefix visible; each remaining child branch is one cluster."""
    hidden = {node for node, depth in depths.items() if depth > hop_depth}
    visited: set[str] = set()
    clusters: list[PreparedCluster] = []

    for node in sorted(neighbors):
        if node in visited:
            continue
        if node not in hidden:
            members = (node,)
            visited.add(node)
        else:
            branch = {node}
            queue = deque([node])
            visited.add(node)
            while queue:
                current = queue.popleft()
                for neighbor, _ in neighbors[current]:
                    if neighbor in hidden and neighbor not in visited:
                        visited.add(neighbor)
                        branch.add(neighbor)
                        queue.append(neighbor)
            members = tuple(sorted(branch))

        member_set = set(members)
        internal: set[str] = set()
        boundary: set[str] = set()
        anchors: set[str] = set()
        for member in members:
            for neighbor, edge_id in neighbors[member]:
                if neighbor in member_set:
                    internal.add(edge_id)
                else:
                    boundary.add(edge_id)
                    anchors.add(member)
        if len(internal) != len(members) - 1:
            raise ValueError("A collapsed cluster must be a connected subtree.")
        if node in hidden and len(boundary) != 1:
            raise ValueError("A collapsed subtree must have one external tree edge.")
        anchor = min(anchors) if node in hidden else node
        clusters.append(
            PreparedCluster(
                cluster_id=f"lod_{lod_level}_{anchor}",
                lod_level=lod_level,
                member_node_ids=members,
                representative_node_id=anchor,
            )
        )
    return tuple(clusters)
