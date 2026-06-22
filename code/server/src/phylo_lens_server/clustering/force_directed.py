from __future__ import annotations

from random import Random

import igraph as ig

from phylo_lens_server.core.models import CanonicalDataset

FORCE_LAYOUT_ITERATIONS = 300
FORCE_LAYOUT_RANDOM_SEED = 11
FORCE_LAYOUT_SCALE = 10.0
DRL_EDGE_CUT = 0.8
DRL_DAMPING_MULTIPLIER = 0.9
DRL_PHASES = ("init", "liquid", "expansion", "cooldown", "crunch", "simmer")


def apply_force_directed_layout_if_needed(
    dataset: CanonicalDataset,
) -> CanonicalDataset:
    """
    This layout is computed once during prepare and then reused by LoD slices.
    """
    if all(node.x is not None and node.y is not None for node in dataset.nodes):
        return dataset

    positions = compute_force_directed_positions(dataset)
    return dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": positions[node.id][0],
                        "y": positions[node.id][1],
                    }
                )
                for node in dataset.nodes
            ]
        }
    )


def compute_force_directed_positions(
    dataset: CanonicalDataset,
) -> dict[str, tuple[float, float]]:
    node_ids = sorted(node.id for node in dataset.nodes)
    if not node_ids:
        return {}

    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    edges = [
        (node_index_by_id[edge.source], node_index_by_id[edge.target])
        for edge in dataset.edges
    ]

    if not edges:
        return circular_fallback_positions(node_ids)

    graph = ig.Graph(n=len(node_ids), edges=edges, directed=False)
    drl_options = {
        "edge_cut": DRL_EDGE_CUT,
        **{f"{phase}_damping_mult": DRL_DAMPING_MULTIPLIER for phase in DRL_PHASES},
    }
    layout = graph.layout_drl(
        options=drl_options,
        seed=random_seed(len(node_ids)),
    )
    layout.fit_into((-1.0, -1.0, 1.0, 1.0), keep_aspect_ratio=True)

    return {
        node_id: (
            float(layout[index][0]) * FORCE_LAYOUT_SCALE,
            float(layout[index][1]) * FORCE_LAYOUT_SCALE,
        )
        for index, node_id in enumerate(node_ids)
    }


def random_seed(size: int) -> list[tuple[float, float]]:
    random = Random(FORCE_LAYOUT_RANDOM_SEED)
    return [(random.uniform(-1.0, 1.0), random.uniform(-1.0, 1.0)) for _ in range(size)]


def circular_fallback_positions(
    node_ids: list[str],
) -> dict[str, tuple[float, float]]:
    seed = ig.Graph.Ring(len(node_ids)).layout_circle()
    return {
        node_id: (
            float(position[0]) * FORCE_LAYOUT_SCALE,
            float(position[1]) * FORCE_LAYOUT_SCALE,
        )
        for node_id, position in zip(node_ids, seed, strict=True)
    }
