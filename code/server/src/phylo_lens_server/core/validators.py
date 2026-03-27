from __future__ import annotations

from phylo_lens_server.core.models import (
    CanonicalDataset,
    DomainValidationError,
)

DUPLICATE_NODE_IDS_ERROR = "Duplicate node ids found."
DUPLICATE_EDGE_IDS_ERROR = "Duplicate edge ids found."

ERR_MISSING_SOURCE_TEMPLATE = "Edge '{edge_id}' has missing source node '{source}'."
ERR_MISSING_TARGET_TEMPLATE = "Edge '{edge_id}' has missing target node '{target}'."
ERR_SELF_LOOP_TEMPLATE = "Edge '{edge_id}' is a self-loop and self-loops are disabled."

ERR_METADATA_UNKNOWN_NODE_TEMPLATE = "Metadata references unknown node '{node_id}'."
ERR_METADATA_UNKNOWN_KEY_TEMPLATE = (
    "Metadata key '{key}' is not declared in metadata schema."
)
ERR_METADATA_TYPE_TEMPLATE = (
    "Metadata key '{key}' for node '{node_id}' does not match type '{expected_type}'."
)

METADATA_TYPE_NULL = "null"
METADATA_TYPE_BOOLEAN = "boolean"
METADATA_TYPE_STRING = "string"
METADATA_TYPE_NUMBER = "number"


def validate_canonical_dataset(
    dataset: CanonicalDataset,
    *,
    allow_self_loops: bool = False,
) -> None:
    """Enforce canonical graph and metadata invariants before downstream processing."""
    errors: list[str] = []

    node_ids = [node.id for node in dataset.nodes]
    node_id_set = set(node_ids)
    if len(node_id_set) != len(node_ids):
        errors.append(DUPLICATE_NODE_IDS_ERROR)

    edge_ids = [edge.id for edge in dataset.edges]
    if len(set(edge_ids)) != len(edge_ids):
        errors.append(DUPLICATE_EDGE_IDS_ERROR)

    for edge in dataset.edges:
        if edge.source not in node_id_set:
            errors.append(
                ERR_MISSING_SOURCE_TEMPLATE.format(edge_id=edge.id, source=edge.source)
            )
        if edge.target not in node_id_set:
            errors.append(
                ERR_MISSING_TARGET_TEMPLATE.format(edge_id=edge.id, target=edge.target)
            )
        if not allow_self_loops and edge.source == edge.target:
            errors.append(ERR_SELF_LOOP_TEMPLATE.format(edge_id=edge.id))

    schema_keys = {field.key: field.type for field in dataset.metadata_schema}
    for node_id, metadata in dataset.metadata_by_node_id.items():
        if node_id not in node_id_set:
            errors.append(ERR_METADATA_UNKNOWN_NODE_TEMPLATE.format(node_id=node_id))
            continue

        for key, value in metadata.items():
            if key not in schema_keys:
                errors.append(ERR_METADATA_UNKNOWN_KEY_TEMPLATE.format(key=key))
                continue

            expected_type = schema_keys[key]
            if not _value_matches_type(value, expected_type):
                errors.append(
                    ERR_METADATA_TYPE_TEMPLATE.format(
                        key=key,
                        node_id=node_id,
                        expected_type=expected_type,
                    )
                )

    if errors:
        raise DomainValidationError(errors)


def _value_matches_type(value: str | float | bool | None, expected_type: str) -> bool:
    """Check whether a metadata value matches a declared canonical metadata type."""
    if expected_type == METADATA_TYPE_NULL:
        return value is None
    if expected_type == METADATA_TYPE_BOOLEAN:
        return isinstance(value, bool)
    if expected_type == METADATA_TYPE_STRING:
        return isinstance(value, str)
    if expected_type == METADATA_TYPE_NUMBER:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return False
