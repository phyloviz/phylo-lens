"""Deterministic dataset builders; scenario assertions stay in their suites."""

from phylo_lens_server.domain.ancillary import AncillaryField, AncillaryType
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset

FORMAT_NEWICK = "newick"

DATASET_ID = "prepared-layout-tree"

WEIGHTED_TREE = "(((d:3,e:4)c:1)b:1)a;"

INTERNAL_COUNT_KEY = "__category_count__region__value__north"


def weighted_tree() -> Dataset:
    result = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_ID,
            content=WEIGHTED_TREE,
        ).to_domain()
    )
    positions = {
        "a": (0.0, 0.0),
        "b": (1.0, 0.0),
        "c": (2.0, 0.0),
        "d": (6.0, 0.0),
        "e": (8.0, 0.0),
    }
    return result.dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={"x": positions[node.id][0], "y": positions[node.id][1]}
                )
                for node in result.dataset.nodes
            ]
        }
    )


def varied_chain_dataset(node_count: int) -> Dataset:
    content = f"n{node_count - 1}"
    for index in range(node_count - 2, -1, -1):
        content = f"({content}:{index + 1})n{index}"
    content = f"{content};"
    result = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=f"chain-{node_count}",
            content=content,
        ).to_domain()
    )
    return result.dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": float(int(node.id.removeprefix("n"))),
                        "y": 0.0,
                    }
                )
                for node in result.dataset.nodes
            ]
        }
    )


def branching_dataset() -> Dataset:
    branches = []
    for branch in range(6):
        chain = f"b{branch}_7"
        for depth in range(6, 0, -1):
            chain = f"({chain}:{depth + 1})b{branch}_{depth}"
        branches.append(f"{chain}:1")
    content = f"({','.join(branches)})root;"
    result = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name="branching-tree",
            content=content,
        ).to_domain()
    )
    return result.dataset


def tree_with_ancillary_data() -> Dataset:
    dataset = weighted_tree()
    metadata_by_node_id = {
        "a": {"region": "north", "score": 10, "flag": True, INTERNAL_COUNT_KEY: 2},
        "b": {"region": "north", "score": 20, "flag": True, INTERNAL_COUNT_KEY: 2},
        "c": {"region": "south", "score": 30, "flag": False, INTERNAL_COUNT_KEY: 2},
        "d": {"region": "south", "score": 5, "flag": False, INTERNAL_COUNT_KEY: 2},
        "e": {"region": "east", "score": 15, "flag": True, INTERNAL_COUNT_KEY: 2},
    }
    return dataset.model_copy(
        update={
            "ancillary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="region", type=AncillaryType.STRING),
                    AncillaryField(key="score", type=AncillaryType.NUMBER),
                    AncillaryField(key="flag", type=AncillaryType.BOOLEAN),
                    AncillaryField(key=INTERNAL_COUNT_KEY, type=AncillaryType.NUMBER),
                ]
                if not is_summary_key(field.key)
            ),
            "summary_schema": tuple(
                field
                for field in [
                    AncillaryField(key="region", type=AncillaryType.STRING),
                    AncillaryField(key="score", type=AncillaryType.NUMBER),
                    AncillaryField(key="flag", type=AncillaryType.BOOLEAN),
                    AncillaryField(key=INTERNAL_COUNT_KEY, type=AncillaryType.NUMBER),
                ]
                if is_summary_key(field.key)
            ),
            "annotations_by_node_id": {
                node_id: decode_node_annotations(values)
                for node_id, values in (metadata_by_node_id).items()
            },
        }
    )
