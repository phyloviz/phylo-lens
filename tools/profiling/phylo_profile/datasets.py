from __future__ import annotations

from datetime import UTC, datetime
import math
from random import Random

from .paths import bootstrap_server_src

bootstrap_server_src()

from phylo_lens_server.domain.models import (  # noqa: E402
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    MetadataField,
    MetadataType,
    SourceFormat,
)


SYNTHETIC_SHAPES = ("balanced", "chain", "star", "forest", "random")


def synthetic_tree_dataset(
    *,
    node_count: int,
    shape: str,
    metadata_fields: int,
    seed: int,
) -> CanonicalDataset:
    rng = Random(seed)
    nodes = [CanonicalNode(id=node_id(index)) for index in range(node_count)]
    edges = synthetic_tree_edges(node_count=node_count, shape=shape, rng=rng)
    metadata_schema = [
        MetadataField(key=f"field_{index:02d}", type=MetadataType.STRING)
        for index in range(metadata_fields)
    ]
    metadata_by_node_id = {
        node.id: {
            field.key: f"value_{(node_index + field_index) % 17:02d}"
            for field_index, field in enumerate(metadata_schema)
        }
        for node_index, node in enumerate(nodes)
    }
    return CanonicalDataset(
        dataset_id=f"profile-{shape}-{node_count}",
        nodes=nodes,
        edges=edges,
        metadata_schema=metadata_schema,
        metadata_by_node_id=metadata_by_node_id,
        source=DatasetSource(
            format=SourceFormat.NEWICK,
            generated_at=datetime.now(UTC).isoformat(),
            provenance=f"tools/profiling synthetic {shape}",
        ),
    )


def synthetic_tree_edges(
    *,
    node_count: int,
    shape: str,
    rng: Random,
) -> list[CanonicalEdge]:
    if node_count <= 1:
        return []

    edges: list[CanonicalEdge] = []
    for child in range(1, node_count):
        parent = parent_for_shape(
            child=child,
            node_count=node_count,
            shape=shape,
            rng=rng,
        )
        if parent is None:
            continue

        distance = 1.0 + ((child * 37) % 100) / 100.0
        edges.append(
            CanonicalEdge(
                id=f"e_{node_id(parent)}_{node_id(child)}",
                source=node_id(parent),
                target=node_id(child),
                distance=distance,
            )
        )
    return edges


def parent_for_shape(
    *,
    child: int,
    node_count: int,
    shape: str,
    rng: Random,
) -> int | None:
    if shape == "chain":
        return child - 1
    if shape == "star":
        return 0
    if shape == "balanced":
        return (child - 1) // 2
    if shape == "random":
        return rng.randrange(0, child)
    if shape == "forest":
        component_size = max(2, int(math.sqrt(node_count)))
        component_root = (child // component_size) * component_size
        if child == component_root:
            return None
        return child - 1
    raise ValueError(f"Unsupported shape: {shape}")


def node_id(index: int) -> str:
    return f"n{index:06d}"
