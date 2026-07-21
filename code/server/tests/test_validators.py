from phylo_lens_server.domain.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    DomainValidationError,
    MetadataField,
)
from phylo_lens_server.domain.validators import validate_canonical_dataset

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
ERR_FRAGMENT_MISSING_TARGET = "missing target node"
ERR_FRAGMENT_TYPE_MISMATCH = "does not match type"


def _dataset() -> CanonicalDataset:
    """Build a reusable valid canonical dataset fixture for validator tests."""
    return CanonicalDataset(
        dataset_id=DATASET_ID,
        nodes=[CanonicalNode(id=NODE_A), CanonicalNode(id=NODE_B)],
        edges=[CanonicalEdge(id=EDGE_ID_A_B, source=NODE_A, target=NODE_B)],
        metadata_schema=[
            MetadataField(key=METADATA_KEY_REGION, type=METADATA_TYPE_STRING)
        ],
        metadata_by_node_id={NODE_A: {METADATA_KEY_REGION: METADATA_VALUE_REGION}},
        source=DatasetSource(format=FORMAT_NEWICK, generated_at=GENERATED_AT),
    )


def test_validate_canonical_dataset_accepts_valid_input() -> None:
    """Ensure valid canonical datasets pass invariant checks."""
    validate_canonical_dataset(_dataset())


def test_validate_canonical_dataset_rejects_missing_node_reference() -> None:
    """Ensure edges cannot reference target nodes missing from the dataset."""
    dataset = _dataset()
    dataset.edges.append(CanonicalEdge(id=EDGE_ID_A_X, source=NODE_A, target=NODE_X))

    try:
        validate_canonical_dataset(dataset)
    except DomainValidationError as err:
        assert ERR_FRAGMENT_MISSING_TARGET in "; ".join(err.errors).lower()
    else:
        raise AssertionError(ERR_EXPECTED_EXCEPTION)


def test_validate_canonical_dataset_rejects_schema_mismatch() -> None:
    """Ensure metadata value types must match declared metadata schema types."""
    dataset = _dataset()
    dataset.metadata_by_node_id[NODE_B] = {METADATA_KEY_REGION: 10}

    try:
        validate_canonical_dataset(dataset)
    except DomainValidationError as err:
        assert ERR_FRAGMENT_TYPE_MISMATCH in "; ".join(err.errors)
    else:
        raise AssertionError(ERR_EXPECTED_EXCEPTION)
