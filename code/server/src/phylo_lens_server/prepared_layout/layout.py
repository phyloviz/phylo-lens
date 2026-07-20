from __future__ import annotations

import logging
from math import cos, hypot, log2, pi, sin
from random import Random
import shlex
import shutil
from statistics import median
import subprocess

from phylo_lens_server.core.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.prepared_layout.models import (
    ClusterLayout,
    LayoutBounds,
    LayoutStatus,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
)

logger = logging.getLogger(__name__)

LAYOUT_RANDOM_SEED = 23
GLOBAL_TARGET_EDGE_LENGTH = 85.0
GRAPHVIZ_SFDP_COMMAND = "sfdp"
# Edge length passed to Graphviz is a ratio-preserving multiple of the
# per-graph median distance, clamped to keep long-branch outliers and
# zero-distance edges from destabilizing the force layout.
GRAPHVIZ_TARGET_EDGE_LENGTH = 2.5
GRAPHVIZ_MIN_EDGE_LENGTH = 0.5
GRAPHVIZ_MAX_EDGE_LENGTH = 12.0

# Default iteration count used when a caller does not derive one from the graph
# size; graphviz_sfdp_positions always passes sfdp_maxiter(node_count) instead.
GRAPHVIZ_BASE_MAXITER = 600

# Reasons a layout degraded to the circular fallback, surfaced to the API so
# the client warning reflects the real cause instead of assuming a missing binary.
LAYOUT_DEGRADED_SFDP_MISSING = "sfdp_missing"
LAYOUT_DEGRADED_SFDP_FAILED = "sfdp_failed"
LAYOUT_DEGRADED_SFDP_INCOMPLETE = "sfdp_incomplete"


def compute_prepared_layouts(
    artifacts: PreparedLayoutArtifacts,
) -> tuple[tuple[ClusterLayout, ...], tuple[NodeLayoutPosition, ...], str | None]:
    """Materialize every LOD as a projection of one Graphviz global layout.

    Returns the cluster layouts, node positions, and a degrade reason (or
    ``None`` when the force layout succeeded).
    """
    global_positions, layout_status, degraded_reason = compute_global_node_positions(
        artifacts.dataset
    )

    cluster_layouts: list[ClusterLayout] = []
    singleton_cluster_by_node_id: dict[str, str] = {}
    fallback_cluster_by_node_id: dict[str, str] = {}
    for cluster in artifacts.clusters:
        member_positions = {
            node_id: global_positions[node_id]
            for node_id in cluster.member_node_ids
            if node_id in global_positions
        }
        for node_id in member_positions:
            fallback_cluster_by_node_id.setdefault(node_id, cluster.cluster_id)
        if cluster.member_count == 1:
            for node_id in member_positions:
                singleton_cluster_by_node_id[node_id] = cluster.cluster_id
        representative_position = global_positions[cluster.representative_node_id]
        bounds = bounds_for_positions(member_positions)
        cluster_layouts.append(
            ClusterLayout(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                cluster_id=cluster.cluster_id,
                representative_node_id=cluster.representative_node_id,
                member_count=cluster.member_count,
                x=representative_position[0],
                y=representative_position[1],
                radius=cluster_radius(member_positions, representative_position),
                bounds=bounds,
                status=layout_status,
            )
        )
    node_positions = tuple(
        NodeLayoutPosition(
            dataset_id=artifacts.dataset.dataset_id,
            layout_version=artifacts.layout_version,
            cluster_id=singleton_cluster_by_node_id.get(
                node_id,
                fallback_cluster_by_node_id[node_id],
            ),
            node_id=node_id,
            x=position[0],
            y=position[1],
            status=layout_status,
        )
        for node_id, position in sorted(global_positions.items())
        if node_id in fallback_cluster_by_node_id
    )

    return tuple(cluster_layouts), node_positions, degraded_reason


def compute_global_node_positions(
    dataset: CanonicalDataset,
) -> tuple[dict[str, tuple[float, float]], LayoutStatus, str | None]:
    """Return the global node layout, a status, and a degrade reason (or None).

    A force-directed layout from Graphviz is reported as ``"ready"``. When the
    ``sfdp`` binary is missing or fails, positions come from a
    circular fallback that ignores tree topology, so the layout is reported as
    ``"degraded"`` and the reason identifies which failure occurred. Trivial
    graphs (zero or one node) need no force layout and are reported ``"ready"``.
    """
    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    if not node_ids:
        return {}, "ready", None
    if len(node_ids) == 1:
        return {node_ids[0]: (0.0, 0.0)}, "ready", None

    graphviz_positions, reason = graphviz_sfdp_positions(node_ids, tuple(dataset.edges))
    if graphviz_positions is not None:
        return (
            normalize_global_positions(
                graphviz_positions,
                edge_indices(node_ids, dataset.edges),
                GLOBAL_TARGET_EDGE_LENGTH,
            ),
            "ready",
            None,
        )

    return jittered_positions(node_ids, GLOBAL_TARGET_EDGE_LENGTH), "degraded", reason


def sfdp_maxiter(node_count: int) -> int:
    """Scale iterations as n*log2(n) for layout quality.

    Prepare runs off the request thread as a background job, so there is no
    wall-time budget to respect; more iterations simply yield a better-converged
    force layout. Larger graphs get proportionally more iterations.
    """
    return round(node_count * log2(max(node_count, 2)))


def graphviz_sfdp_positions(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
) -> tuple[dict[str, tuple[float, float]] | None, str | None]:
    if shutil.which(GRAPHVIZ_SFDP_COMMAND) is None:
        logger.warning(
            "Graphviz '%s' not found on PATH; falling back to a circular layout. "
            "Install Graphviz to enable force-directed layouts.",
            GRAPHVIZ_SFDP_COMMAND,
        )
        return None, LAYOUT_DEGRADED_SFDP_MISSING

    payload = graphviz_dot_payload(node_ids, edges, maxiter=sfdp_maxiter(len(node_ids)))
    try:
        completed = subprocess.run(
            [GRAPHVIZ_SFDP_COMMAND, "-Tplain"],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        logger.warning(
            "Graphviz '%s' layout failed (%s); falling back to a circular layout.",
            GRAPHVIZ_SFDP_COMMAND,
            type(error).__name__,
        )
        return None, LAYOUT_DEGRADED_SFDP_FAILED

    positions = parse_graphviz_plain_positions(completed.stdout)
    if set(positions) != set(node_ids):
        logger.warning(
            "Graphviz '%s' returned positions for %d of %d nodes; "
            "falling back to a circular layout.",
            GRAPHVIZ_SFDP_COMMAND,
            len(positions),
            len(node_ids),
        )
        return None, LAYOUT_DEGRADED_SFDP_INCOMPLETE
    return positions, None


def has_multiple_components(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
) -> bool:
    """Report whether the graph splits into more than one connected component.

    sfdp's ``overlap=scale`` runs global overlap removal across every component
    at once, which is pathological for a forest with thousands of disconnected
    pieces (a goeBURST export leaves distant STs unlinked). When the graph is
    disconnected we lay each component out independently and pack the results,
    which keeps a single connected tree's layout unchanged.
    """
    known_node_ids = set(node_ids)
    parent = {node_id: node_id for node_id in node_ids}

    def find(node_id: str) -> str:
        root = node_id
        while parent[root] != root:
            parent[root] = parent[parent[root]]
            root = parent[root]
        return root

    components = len(node_ids)
    for edge in edges:
        if edge.source not in known_node_ids or edge.target not in known_node_ids:
            continue
        left, right = find(edge.source), find(edge.target)
        if left != right:
            parent[right] = left
            components -= 1
            if components == 1:
                return False
    return components > 1


def graphviz_dot_payload(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
    *,
    maxiter: int = GRAPHVIZ_BASE_MAXITER,
) -> str:
    known_node_ids = set(node_ids)
    reference_distance = reference_edge_distance(edges, known_node_ids)
    # A connected tree keeps sfdp's default global overlap removal; a disconnected
    # forest lays each component out independently and packs them, which avoids
    # the pathological global overlap pass without altering the connected case.
    if has_multiple_components(node_ids, edges):
        graph_attrs = (
            "  graph [layout=sfdp, overlap=prism, pack=true, packmode=array, "
            f"splines=false, outputorder=edgesfirst, maxiter={maxiter}];"
        )
    else:
        graph_attrs = (
            "  graph [layout=sfdp, overlap=scale, splines=false, "
            f"outputorder=edgesfirst, maxiter={maxiter}];"
        )
    lines = [
        "graph {",
        graph_attrs,
        '  node [shape=point, width=0.04, height=0.04, label=""];',
    ]
    for node_id in node_ids:
        lines.append(f"  {quote_dot_id(node_id)};")
    for edge in edges:
        if edge.source not in known_node_ids or edge.target not in known_node_ids:
            continue
        lines.append(
            "  "
            f"{quote_dot_id(edge.source)} -- {quote_dot_id(edge.target)} "
            f"[len={graphviz_edge_length(edge.distance, reference_distance):.6g}];"
        )
    lines.append("}")
    return "\n".join(lines)


def reference_edge_distance(
    edges: tuple[CanonicalEdge, ...],
    known_node_ids: set[str],
) -> float:
    """Median of positive edge distances, used to normalize ``len=`` by scale."""
    distances = [
        edge.distance
        for edge in edges
        if edge.source in known_node_ids
        and edge.target in known_node_ids
        and edge.distance is not None
        and edge.distance > 0.0
    ]
    return median(distances) if distances else 0.0


def graphviz_edge_length(distance: float | None, reference_distance: float) -> float:
    """Ratio-preserving edge length: a multiple of ``distance / reference``.

    Using a multiplicative scale keeps relative branch lengths intact (a branch
    twice as long stays twice as long), unlike an additive offset which crushes
    small differences toward uniformity. Absent or non-positive distances and a
    missing reference fall back to the target length; the clamp bounds outliers.
    """
    if distance is None or distance <= 0.0 or reference_distance <= 0.0:
        return GRAPHVIZ_TARGET_EDGE_LENGTH
    scaled = GRAPHVIZ_TARGET_EDGE_LENGTH * (distance / reference_distance)
    return min(GRAPHVIZ_MAX_EDGE_LENGTH, max(GRAPHVIZ_MIN_EDGE_LENGTH, scaled))


def parse_graphviz_plain_positions(output: str) -> dict[str, tuple[float, float]]:
    positions: dict[str, tuple[float, float]] = {}
    for line in output.splitlines():
        parts = shlex.split(line)
        if len(parts) < 4 or parts[0] != "node":
            continue
        positions[unescape_plain_id(parts[1])] = (float(parts[2]), float(parts[3]))
    return positions


def quote_dot_id(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def unescape_plain_id(value: str) -> str:
    return value.replace('\\"', '"').replace("\\\\", "\\")


def edge_indices(
    node_ids: tuple[str, ...],
    edges: list[CanonicalEdge],
) -> list[tuple[int, int]]:
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    return [
        (node_index_by_id[edge.source], node_index_by_id[edge.target])
        for edge in edges
        if edge.source in node_index_by_id and edge.target in node_index_by_id
    ]


def normalize_global_positions(
    positions: dict[str, tuple[float, float]],
    edges: list[tuple[int, int]],
    target_edge_length: float,
) -> dict[str, tuple[float, float]]:
    node_ids = tuple(positions)
    center_x = sum(position[0] for position in positions.values()) / len(positions)
    center_y = sum(position[1] for position in positions.values()) / len(positions)
    centered = {
        node_id: (position[0] - center_x, position[1] - center_y)
        for node_id, position in positions.items()
    }
    edge_lengths = [
        hypot(
            centered[node_ids[source]][0] - centered[node_ids[target]][0],
            centered[node_ids[source]][1] - centered[node_ids[target]][1],
        )
        for source, target in edges
    ]
    positive_edge_lengths = [length for length in edge_lengths if length > 0.0]
    reference_length = median(positive_edge_lengths) if positive_edge_lengths else 0.0
    scale = target_edge_length / reference_length if reference_length > 0.0 else 1.0
    normalized = {
        node_id: (position[0] * scale, position[1] * scale)
        for node_id, position in centered.items()
    }
    return ensure_two_axis_spread(normalized, target_edge_length)


def ensure_two_axis_spread(
    positions: dict[str, tuple[float, float]],
    target_edge_length: float,
) -> dict[str, tuple[float, float]]:
    """Add deterministic separation when Graphviz collapses onto a line."""
    if len(positions) < 3:
        return positions

    xs = [position[0] for position in positions.values()]
    ys = [position[1] for position in positions.values()]
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)
    largest_span = max(x_span, y_span)
    smallest_span = min(x_span, y_span)
    if largest_span <= 0.0:
        return circular_spread(positions, target_edge_length)
    if smallest_span > largest_span * 0.2:
        return positions

    amplitude = max(largest_span * 0.35, target_edge_length)
    ordered_ids = tuple(sorted(positions))
    denominator = max(len(ordered_ids) - 1, 1)
    repaired: dict[str, tuple[float, float]] = {}
    for index, node_id in enumerate(ordered_ids):
        x, y = positions[node_id]
        offset = sin((index / denominator) * pi * 2.0) * amplitude
        if x_span < y_span:
            repaired[node_id] = (x + offset, y)
        else:
            repaired[node_id] = (x, y + offset)
    return repaired


def circular_spread(
    positions: dict[str, tuple[float, float]],
    target_edge_length: float,
) -> dict[str, tuple[float, float]]:
    center_x = sum(position[0] for position in positions.values()) / len(positions)
    center_y = sum(position[1] for position in positions.values()) / len(positions)
    ordered_ids = tuple(sorted(positions))
    radius = max(target_edge_length, target_edge_length * len(ordered_ids) / pi)
    return {
        node_id: (
            center_x + cos(2.0 * pi * index / len(ordered_ids)) * radius,
            center_y + sin(2.0 * pi * index / len(ordered_ids)) * radius,
        )
        for index, node_id in enumerate(ordered_ids)
    }


def jittered_positions(
    node_ids: tuple[str, ...],
    scale: float,
) -> dict[str, tuple[float, float]]:
    random = Random(LAYOUT_RANDOM_SEED + len(node_ids))
    positions: dict[str, tuple[float, float]] = {}
    for index, node_id in enumerate(node_ids):
        angle = 2.0 * pi * index / len(node_ids) + random.uniform(-0.35, 0.35)
        radius = scale * random.uniform(0.75, 1.25)
        positions[node_id] = (cos(angle) * radius, sin(angle) * radius)
    return positions


def cluster_radius(
    positions: dict[str, tuple[float, float]],
    center: tuple[float, float],
) -> float:
    if not positions:
        return 0.0
    return max(
        hypot(position[0] - center[0], position[1] - center[1])
        for position in positions.values()
    )


def bounds_for_positions(positions: dict[str, tuple[float, float]]) -> LayoutBounds:
    if not positions:
        return LayoutBounds(min_x=0.0, max_x=0.0, min_y=0.0, max_y=0.0)
    xs = [position[0] for position in positions.values()]
    ys = [position[1] for position in positions.values()]
    return LayoutBounds(min_x=min(xs), max_x=max(xs), min_y=min(ys), max_y=max(ys))
