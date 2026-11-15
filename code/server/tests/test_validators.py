import pytest
from pydantic import ValidationError

from phylo_lens_server.domain.ancillary import AncillaryField, NodeAnnotations
from phylo_lens_server.domain.dataset import (
    NEWICK_ROOTING_STRATEGY,
    Dataset,
    DatasetSource,
    DomainValidationError,
    GraphEdge,
    GraphNode,
)
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.validators import validate_dataset
from phylo_lens_server.http.graph.schemas import NormalizeRequest

DATASET_ID = "test"
NODE_A = "a"
NODE_B = "b"
NODE_X = "x"

EDGE_ID_A_B = "e_a_b_1"
EDGE_ID_A_X = "e_a_x_1"

FORMAT_NEWICK = "newick"
GENERATED_AT = "2026-03-23T00:00:00Z"

METADATA_KEY_REGION = "region"
METADATA_VALUE_REGION = "EU"
METADATA_TYPE_STRING = "string"

ERR_EXPECTED_EXCEPTION = "Expected DomainValidationError"
ERR_FRAGMENT_TYPE_MISMATCH = "does not match type"


def _dataset() -> Dataset:
    """Build a reusable valid canonical dataset fixture for validator tests."""
    return Dataset(
        dataset_id=DATASET_ID,
        nodes=[GraphNode(id=NODE_A), GraphNode(id=NODE_B)],
        edges=[GraphEdge(id=EDGE_ID_A_B, source=NODE_A, target=NODE_B)],
        technical_roots=(NODE_A,),
        ancillary_schema=tuple(
            field
            for field in [
                AncillaryField(key=METADATA_KEY_REGION, type=METADATA_TYPE_STRING)
            ]
            if not is_summary_key(field.key)
        ),
        summary_schema=tuple(
            field
            for field in [
                AncillaryField(key=METADATA_KEY_REGION, type=METADATA_TYPE_STRING)
            ]
            if is_summary_key(field.key)
        ),
        annotations_by_node_id={
            node_id: decode_node_annotations(values)
            for node_id, values in (
                {NODE_A: {METADATA_KEY_REGION: METADATA_VALUE_REGION}}
            ).items()
        },
        source=DatasetSource(
            format=FORMAT_NEWICK,
            generated_at=GENERATED_AT,
            rooting_strategy=NEWICK_ROOTING_STRATEGY,
        ),
    )


def test_validate_dataset_accepts_valid_input() -> None:
    """Ensure valid canonical datasets pass invariant checks."""
    validate_dataset(_dataset())


def test_self_loop_option_cannot_enable_non_tree_preparation():
    with pytest.raises(ValidationError):
        NormalizeRequest(
            format="newick", content="A;", options={"allow_self_loops": True}
        )


def test_validate_dataset_rejects_missing_node_reference() -> None:
    """Ensure edges cannot reference target nodes missing from the dataset."""
    dataset = _dataset()
    with pytest.raises(ValidationError, match="unknown endpoint"):
        dataset.model_copy(
            update={
                "edges": (
                    *dataset.edges,
                    GraphEdge(id=EDGE_ID_A_X, source=NODE_A, target=NODE_X),
                )
            }
        )


@pytest.mark.parametrize(
    "edges",
    [
        [("a", "b"), ("b", "c"), ("c", "a")],
        [("a", "a")],
        [("a", "b"), ("b", "a")],
    ],
)
def test_dataset_rejects_cycles_self_loops_and_parallel_edges_at_construction(edges):
    value = _dataset().model_dump()
    value.update(
        nodes=[{"id": node} for node in "abc"],
        edges=[
            {"id": str(i), "source": a, "target": b} for i, (a, b) in enumerate(edges)
        ],
    )
    with pytest.raises(ValidationError):
        Dataset.model_validate(value)


def test_dataset_copy_and_persistence_cannot_bypass_forest_validation():
    value = _dataset()
    with pytest.raises(ValidationError, match="acyclic"):
        value.model_copy(
            update={
                "nodes": [GraphNode(id=node) for node in "abc"],
                "edges": [
                    GraphEdge(id=str(i), source=a, target=b)
                    for i, (a, b) in enumerate([("a", "b"), ("b", "c"), ("c", "a")])
                ],
            }
        )
    payload = value.model_dump()
    payload["edges"] = (*payload["edges"], {"id": "loop", "source": "a", "target": "a"})
    with pytest.raises(ValidationError):
        Dataset.model_validate(payload)


def test_validate_dataset_rejects_schema_mismatch() -> None:
    """Ensure metadata value types must match declared metadata schema types."""
    dataset = _dataset()
    dataset = dataset.model_copy(
        update={
            "annotations_by_node_id": {
                **dataset.annotations_by_node_id,
                NODE_B: NodeAnnotations(ancillary_data={METADATA_KEY_REGION: 10}),
            }
        }
    )

    try:
        validate_dataset(dataset)
    except DomainValidationError as err:
        assert ERR_FRAGMENT_TYPE_MISMATCH in "; ".join(err.errors)
    else:
        raise AssertionError(ERR_EXPECTED_EXCEPTION)
