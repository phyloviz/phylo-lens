from __future__ import annotations

import csv
from collections.abc import Mapping, Sequence
from io import StringIO
from math import isfinite
from urllib.parse import quote

from phylo_lens_server.data.parsers import ParseError, slugify_label
from phylo_lens_server.domain.ancillary import (
    AncillaryData,
    AncillaryField,
    AncillaryValue,
)
from phylo_lens_server.domain.legacy_metadata import (
    CATEGORY_COUNT_FIELD_PREFIX,
    PROFILE_COUNT_FIELD,
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.models import GraphNode, Isolate, SourceFormat
from phylo_lens_server.domain.revisions import AncillaryReplacement, AncillaryTable

DEFAULT_DATASET_NAME = "dataset"
DEFAULT_ROUND_DECIMALS = 3
EDGE_ID_TEMPLATE = "e_{source}_{target}_{count}"

ANCILLARY_TYPE_STRING = "string"
ANCILLARY_TYPE_NULL = "null"
ANCILLARY_TYPE_BOOLEAN = "boolean"
ANCILLARY_TYPE_NUMBER = "number"

CATEGORY_COUNT_FIELD_SEPARATOR = "__value__"

ANCILLARY_FORMAT_CSV = "csv"
ANCILLARY_FORMAT_TSV = "tsv"
ANCILLARY_FORMAT_AUTO = "auto"

ERR_ANCILLARY_EMPTY = "Ancillary data content is empty."
ERR_ANCILLARY_HEADER = "Ancillary data must include a header row."
ERR_ANCILLARY_JOIN_COLUMN = (
    "Ancillary join column '{join_column}' was not found in the header."
)
ERR_RESERVED_METADATA_KEY = "Metadata key '{key}' is reserved for internal use."
WARN_ANCILLARY_UNMATCHED_ROW = (
    "Ancillary row {row_index} with {join_column}='{join_value}' did not match a node."
)
WARN_ANCILLARY_UNMATCHED_NODE_COUNT = (
    "Ancillary data did not include rows for {count} joinable nodes."
)

ERR_UNSUPPORTED_FORMAT = "Unsupported format '{format_name}'."
ERR_NONFINITE_DISTANCE = "Edge distance on '{source}' -> '{target}' must be finite."
WARN_NEGATIVE_DISTANCE_CLAMPED = (
    "Negative edge distance {distance} on '{source}' -> '{target}' was clamped to 0.0."
)


def _ancillary_join_node_ids(
    format_name: SourceFormat,
    *,
    nodes: list[GraphNode],
    explicit_node_ids: set[str],
) -> set[str]:
    """Resolve node ids eligible for tabular metadata joins."""
    node_ids = {node.id for node in nodes}
    if format_name == SourceFormat.NEWICK:
        return explicit_node_ids & node_ids

    return node_ids


def _parse_ancillary_data(
    ancillary_data: AncillaryTable,
    *,
    node_ids: set[str],
    declared_schema: list[AncillaryField],
) -> tuple[
    dict[str, AncillaryData],
    dict[str, list[AncillaryData]],
    list[str],
]:
    """Parse CSV/TSV ancillary metadata and join rows to canonical node ids."""
    content = ancillary_data.content.strip()
    if not content:
        raise ParseError(ERR_ANCILLARY_EMPTY)

    delimiter = _detect_ancillary_delimiter(content, ancillary_data.format)
    reader = csv.DictReader(StringIO(content), delimiter=delimiter)
    if not reader.fieldnames:
        raise ParseError(ERR_ANCILLARY_HEADER)

    headers = [header.strip() for header in reader.fieldnames]
    join_column = ancillary_data.join_column.strip()
    if join_column not in headers:
        raise ParseError(
            ERR_ANCILLARY_JOIN_COLUMN.format(join_column=ancillary_data.join_column)
        )
    _reject_reserved_ancillary_headers(headers, join_column)

    raw_rows: list[tuple[int, str, dict[str, str | None]]] = []
    for row_index, row in enumerate(reader, start=2):
        join_value = _normalize_cell(row.get(join_column))
        if join_value is None:
            continue

        values = {
            header: _normalize_cell(row.get(header))
            for header in headers
            if header != join_column
        }
        raw_rows.append((row_index, join_value, values))

    field_types = _infer_ancillary_field_types(
        [values for _, _, values in raw_rows],
    )
    field_types.update(_declared_ancillary_types(declared_schema))
    rows_by_node_id: dict[str, list[AncillaryData]] = {}
    warnings: list[str] = []

    for row_index, join_value, values in raw_rows:
        node_id = _resolve_ancillary_node_id(join_value, node_ids)
        if node_id is None:
            warnings.append(
                WARN_ANCILLARY_UNMATCHED_ROW.format(
                    row_index=row_index,
                    join_column=join_column,
                    join_value=join_value,
                )
            )
            continue

        rows_by_node_id.setdefault(node_id, []).append(
            {
                key: _coerce_ancillary_value(value, field_types[key])
                for key, value in values.items()
            }
        )

    metadata_by_node_id = {
        node_id: _aggregate_ancillary_rows(rows)
        for node_id, rows in rows_by_node_id.items()
    }

    missing_count = len(node_ids - set(metadata_by_node_id))
    if missing_count:
        warnings.append(WARN_ANCILLARY_UNMATCHED_NODE_COUNT.format(count=missing_count))

    return metadata_by_node_id, rows_by_node_id, warnings


def build_ancillary_replacement(
    request: AncillaryTable,
    node_ids: frozenset[str],
    isolates_by_node_id: Mapping[str, Sequence[Isolate]],
) -> AncillaryReplacement:
    """Replace observations, preserving biological identity and profile membership."""
    join_ids = (
        {
            isolate.id
            for isolates in isolates_by_node_id.values()
            for isolate in isolates
        }
        if isolates_by_node_id
        else node_ids
    )
    values, rows, warnings = _parse_ancillary_data(
        request, node_ids=join_ids, declared_schema=[]
    )
    if not values:
        raise ParseError(
            "Ancillary table does not match any isolates or nodes in this layout."
        )
    replacements: dict[str, list[Isolate]] = {}
    matched_nodes = set(values)
    if isolates_by_node_id:
        if any(len(items) > 1 for items in rows.values()):
            raise ParseError(
                "Typing ancillary data must contain at most one row per isolate ID."
            )
        replacements = {
            node_id: [
                Isolate(id=isolate.id, ancillary_data=rows.get(isolate.id, [{}])[0])
                for isolate in isolates
            ]
            for node_id, isolates in isolates_by_node_id.items()
        }
        matched_nodes = {
            node_id
            for node_id, isolates in isolates_by_node_id.items()
            if any(isolate.id in rows for isolate in isolates)
        }
        values = {
            node_id: _aggregate_ancillary_rows(
                [isolate.ancillary_data for isolate in isolates]
            )
            for node_id, isolates in replacements.items()
        }
    schema = _merge_annotation_schema([], values)
    values = _coerce_ancillary_by_declared_schema(
        values, _declared_ancillary_types(schema)
    )
    return AncillaryReplacement(
        schema=tuple(field for field in schema if not is_summary_key(field.key)),
        annotations_by_node_id={
            key: decode_node_annotations(value) for key, value in values.items()
        },
        isolates_by_node_id={key: tuple(value) for key, value in replacements.items()},
        matched_node_count=len(matched_nodes),
        warnings=tuple(warnings),
    )


def _reject_reserved_ancillary_keys(
    metadata_schema: list[AncillaryField],
    metadata_by_node_id: dict[str, AncillaryData],
) -> None:
    for field in metadata_schema:
        _reject_reserved_metadata_key(field.key)

    for metadata in metadata_by_node_id.values():
        for key in metadata:
            _reject_reserved_metadata_key(key)


def _merge_node_ancillary_data(
    explicit_metadata: dict[str, AncillaryData],
    ancillary_metadata: dict[str, AncillaryData],
) -> dict[str, AncillaryData]:
    """Merge metadata per node and field, preserving direct caller values."""
    merged = {
        node_id: dict(metadata) for node_id, metadata in ancillary_metadata.items()
    }
    for node_id, metadata in explicit_metadata.items():
        merged[node_id] = {**merged.get(node_id, {}), **metadata}
    return merged


def _reject_reserved_ancillary_headers(headers: list[str], join_column: str) -> None:
    for header in headers:
        if header == join_column:
            continue
        _reject_reserved_metadata_key(header)


def _reject_reserved_metadata_key(key: str) -> None:
    if is_summary_key(key):
        raise ParseError(ERR_RESERVED_METADATA_KEY.format(key=key))


def _aggregate_ancillary_rows(
    rows: list[AncillaryData],
) -> AncillaryData:
    """Aggregate multiple isolate rows onto one profile/ST node."""
    metadata: AncillaryData = {
        PROFILE_COUNT_FIELD: len(rows),
    }
    keys = {key for row in rows for key in row}

    for key in keys:
        values = [row.get(key) for row in rows if row.get(key) is not None]
        if not values:
            metadata[key] = None
            continue

        unique_values = _unique_preserving_order(values)
        metadata[key] = (
            unique_values[0]
            if len(unique_values) == 1
            else ";".join(str(value) for value in unique_values)
        )

        counts: dict[str, int] = {}
        for value in values:
            category = str(value)
            counts[category] = counts.get(category, 0) + 1
        for category, count in counts.items():
            metadata[_category_count_field_key(key, category)] = count

    return metadata


def _unique_preserving_order(
    values: list[AncillaryValue],
) -> list[str | float | bool]:
    unique_values: list[str | float | bool] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        comparable = f"{type(value).__name__}:{value}"
        if comparable in seen:
            continue
        seen.add(comparable)
        unique_values.append(value)
    return unique_values


def _category_count_field_key(field_key: str, category: str) -> str:
    field_token = quote(field_key, safe="")
    category_token = quote(category, safe="")
    return (
        f"{CATEGORY_COUNT_FIELD_PREFIX}{field_token}"
        f"{CATEGORY_COUNT_FIELD_SEPARATOR}{category_token}"
    )


def _detect_ancillary_delimiter(content: str, format_name: str) -> str:
    """Resolve user-selected or inferred tabular delimiter."""
    if format_name == ANCILLARY_FORMAT_TSV:
        return "\t"
    if format_name == ANCILLARY_FORMAT_CSV:
        return ","

    first_line = content.splitlines()[0]
    if "\t" in first_line:
        return "\t"
    return ","


def _normalize_cell(value: str | None) -> str | None:
    """Normalize blank tabular cells to null while preserving non-empty text."""
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _resolve_ancillary_node_id(join_value: str, node_ids: set[str]) -> str | None:
    """Join table identifiers to graph node IDs using exact and normalized matches."""
    if join_value in node_ids:
        return join_value

    slug = slugify_label(join_value)
    if slug in node_ids:
        return slug

    return None


def _infer_ancillary_field_types(
    rows: list[dict[str, str | None]],
) -> dict[str, str]:
    """Infer one stable scalar type per ancillary column before coercion."""
    field_types: dict[str, str] = {}
    keys = {key for row in rows for key in row}
    for key in keys:
        values = [row[key] for row in rows if row.get(key) is not None]
        if not values:
            field_types[key] = ANCILLARY_TYPE_NULL
            continue
        if all(_is_boolean_literal(value) for value in values):
            field_types[key] = ANCILLARY_TYPE_BOOLEAN
            continue
        if all(_is_number_literal(value) for value in values):
            field_types[key] = ANCILLARY_TYPE_NUMBER
            continue
        field_types[key] = ANCILLARY_TYPE_STRING
    return field_types


def _coerce_ancillary_value(
    value: str | None,
    ancillary_type: str,
) -> AncillaryValue:
    """Coerce one ancillary cell according to the inferred column type."""
    if value is None:
        return None
    if ancillary_type == ANCILLARY_TYPE_BOOLEAN:
        return value.lower() == "true"
    if ancillary_type == ANCILLARY_TYPE_NUMBER:
        number = float(value)
        if number.is_integer():
            return int(number)
        return number
    return value


def _is_boolean_literal(value: str) -> bool:
    return value.lower() in {"true", "false"}


def _is_number_literal(value: str) -> bool:
    if len(value) > 1 and value.startswith("0") and value[1].isdigit():
        return False
    try:
        number = float(value)
    except ValueError:
        return False
    return isfinite(number)


def _infer_annotation_schema(
    metadata_by_node_id: dict[str, AncillaryData],
) -> list[AncillaryField]:
    """Infer metadata field types from node metadata dictionaries."""
    inferred: dict[str, str] = {}
    for metadata in metadata_by_node_id.values():
        for key, value in metadata.items():
            value_type = _ancillary_value_type(value)
            current = inferred.get(key)
            if current is None:
                inferred[key] = value_type
                continue
            if value_type == ANCILLARY_TYPE_NULL:
                continue
            if current == ANCILLARY_TYPE_NULL:
                inferred[key] = value_type
                continue
            if current != value_type:
                inferred[key] = ANCILLARY_TYPE_STRING

    return [
        AncillaryField(key=key, type=metadata_type)
        for key, metadata_type in sorted(inferred.items())
    ]


def _merge_annotation_schema(
    declared_schema: list[AncillaryField],
    metadata_by_node_id: dict[str, AncillaryData],
) -> list[AncillaryField]:
    """Preserve declared metadata fields while adding inferred fields for new keys."""
    inferred_schema = _infer_annotation_schema(metadata_by_node_id)
    if not declared_schema:
        return inferred_schema

    declared_keys = {field.key for field in declared_schema}
    inferred_additions = [
        field for field in inferred_schema if field.key not in declared_keys
    ]
    return [*declared_schema, *inferred_additions]


def _declared_ancillary_types(declared_schema: list[AncillaryField]) -> dict[str, str]:
    """Return caller-declared metadata types keyed by field name."""
    return {field.key: field.type.value for field in declared_schema}


def _coerce_ancillary_by_declared_schema(
    metadata_by_node_id: dict[str, AncillaryData],
    declared_types: dict[str, str],
) -> dict[str, AncillaryData]:
    """Apply caller-declared scalar types to direct node metadata payloads."""
    if not declared_types:
        return dict(metadata_by_node_id)

    return {
        node_id: {
            key: (
                _coerce_ancillary_value_by_type(value, declared_types[key])
                if key in declared_types
                else value
            )
            for key, value in metadata.items()
        }
        for node_id, metadata in metadata_by_node_id.items()
    }


def _coerce_ancillary_value_by_type(
    value: AncillaryValue,
    ancillary_type: str,
) -> AncillaryValue:
    if value is None:
        return None
    if ancillary_type == ANCILLARY_TYPE_STRING:
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    if ancillary_type == ANCILLARY_TYPE_NUMBER and isinstance(value, str):
        return _coerce_ancillary_value(value, ancillary_type)
    if ancillary_type == ANCILLARY_TYPE_BOOLEAN and isinstance(value, str):
        return _coerce_ancillary_value(value, ancillary_type)
    return value


def _ancillary_value_type(value: AncillaryValue) -> str:
    """Map Python values to ancillary scalar types."""
    if value is None:
        return ANCILLARY_TYPE_NULL
    if isinstance(value, bool):
        return ANCILLARY_TYPE_BOOLEAN
    if isinstance(value, (int, float)):
        return ANCILLARY_TYPE_NUMBER
    return ANCILLARY_TYPE_STRING
