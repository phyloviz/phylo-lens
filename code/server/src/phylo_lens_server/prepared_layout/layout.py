from __future__ import annotations

from math import cos, hypot, pi, sin
from random import Random
import shlex
import shutil
from statistics import median
import subprocess

from phylo_lens_server.core.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.prepared_layout.models import (
    ClusterLayout,
    LayoutBounds,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
)

LAYOUT_RANDOM_SEED = 23
GLOBAL_TARGET_EDGE_LENGTH = 85.0
GRAPHVIZ_SFDP_COMMAND = "sfdp"
GRAPHVIZ_LAYOUT_TIMEOUT_SECONDS = 15
GRAPHVIZ_DEFAULT_EDGE_LENGTH = 2.5
GRAPHVIZ_MIN_EDGE_LENGTH = 0.5
GRAPHVIZ_MAX_EDGE_LENGTH = 12.0


def compute_prepared_layouts(
    artifacts: PreparedLayoutArtifacts,
) -> tuple[tuple[ClusterLayout, ...], tuple[NodeLayoutPosition, ...]]:
    """Materialize every LOD as a projection of one Graphviz global layout."""
    global_positions = compute_global_node_positions(artifacts.dataset)

    cluster_layouts: list[ClusterLayout] = []
    node_positions: list[NodeLayoutPosition] = []
    for cluster in artifacts.clusters:
        member_positions = {
            node_id: global_positions[node_id]
            for node_id in cluster.member_node_ids
            if node_id in global_positions
        }
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
                status="ready",
            )
        )
        node_positions.extend(
            NodeLayoutPosition(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                cluster_id=cluster.cluster_id,
                node_id=node_id,
                x=position[0],
                y=position[1],
                lod_min=0,
                lod_max=999,
                status="ready",
            )
            for node_id, position in sorted(member_positions.items())
        )

    return tuple(cluster_layouts), tuple(node_positions)


def compute_global_node_positions(
    dataset: CanonicalDataset,
) -> dict[str, tuple[float, float]]:
    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    if not node_ids:
        return {}
    if len(node_ids) == 1:
        return {node_ids[0]: (0.0, 0.0)}

    graphviz_positions = graphviz_sfdp_positions(node_ids, tuple(dataset.edges))
    if graphviz_positions is not None:
        return normalize_global_positions(
            graphviz_positions,
            edge_indices(node_ids, dataset.edges),
            GLOBAL_TARGET_EDGE_LENGTH,
        )

    return jittered_positions(node_ids, GLOBAL_TARGET_EDGE_LENGTH)


def graphviz_sfdp_positions(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
) -> dict[str, tuple[float, float]] | None:
    if shutil.which(GRAPHVIZ_SFDP_COMMAND) is None:
        return None

    payload = graphviz_dot_payload(node_ids, edges)
    try:
        completed = subprocess.run(
            [GRAPHVIZ_SFDP_COMMAND, "-Tplain"],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
            timeout=GRAPHVIZ_LAYOUT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None

    positions = parse_graphviz_plain_positions(completed.stdout)
    if set(positions) != set(node_ids):
        return None
    return positions


def graphviz_dot_payload(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
) -> str:
    lines = [
        "graph {",
        (
            "  graph [layout=sfdp, overlap=scale, splines=false, "
            "outputorder=edgesfirst, maxiter=100];"
        ),
        '  node [shape=point, width=0.04, height=0.04, label=""];',
    ]
    known_node_ids = set(node_ids)
    for node_id in node_ids:
        lines.append(f"  {quote_dot_id(node_id)};")
    for edge in edges:
        if edge.source not in known_node_ids or edge.target not in known_node_ids:
            continue
        lines.append(
            "  "
            f"{quote_dot_id(edge.source)} -- {quote_dot_id(edge.target)} "
            f"[len={graphviz_edge_length(edge.distance):.6g}];"
        )
    lines.append("}")
    return "\n".join(lines)


def graphviz_edge_length(distance: float | None) -> float:
    if distance is None:
        return GRAPHVIZ_DEFAULT_EDGE_LENGTH
    return min(
        GRAPHVIZ_MAX_EDGE_LENGTH,
        max(GRAPHVIZ_MIN_EDGE_LENGTH, GRAPHVIZ_DEFAULT_EDGE_LENGTH + distance),
    )


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
    return {
        node_id: (position[0] * scale, position[1] * scale)
        for node_id, position in centered.items()
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
