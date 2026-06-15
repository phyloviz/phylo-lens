from __future__ import annotations

import csv
from io import StringIO
from math import isfinite
from urllib.parse import quote
import time
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    MetadataField,
)
from phylo_lens_server.core.metadata_keys import (
    CATEGORY_COUNT_FIELD_PREFIX,
    PROFILE_COUNT_FIELD,
    is_internal_metadata_key,
    public_metadata_schema_dataset,
)
from phylo_lens_server.core.validators import validate_canonical_dataset
from phylo_lens_server.data.parsers import (
    ParseError,
    parse_edgelist,
    parse_newick,
    slugify_label,
)


class NormalizeFormat(StrEnum):
    """Supported input formats for dataset normalization requests."""

    NEWICK = "newick"
    EDGELIST = "edgelist"
    # TYPING_DATA = "typing_data"


DEFAULT_DATASET_NAME = "dataset"
DEFAULT_ROUND_DECIMALS = 3
EDGE_ID_TEMPLATE = "e_{source}_{target}_{count}"

METADATA_TYPE_STRING = "string"
METADATA_TYPE_NULL = "null"
METADATA_TYPE_BOOLEAN = "boolean"
METADATA_TYPE_NUMBER = "number"

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


class NormalizeOptions(BaseModel):
    allow_self_loops: bool = False


class AncillaryDataRequest(BaseModel):
    """Tabular node metadata supplied by users alongside graph/tree content."""

    content: str = Field(min_length=1)
    join_column: str = Field(min_length=1)
    format: Literal["auto", "csv", "tsv"] = ANCILLARY_FORMAT_AUTO


class NormalizeRequest(BaseModel):
    format: NormalizeFormat
    dataset_name: str = Field(default=DEFAULT_DATASET_NAME, min_length=1)
    content: str = Field(min_length=1)
    options: NormalizeOptions = Field(default_factory=NormalizeOptions)
    metadata_schema: list[MetadataField] = Field(default_factory=list)
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]] = Field(
        default_factory=dict
    )
    ancillary_data: AncillaryDataRequest | None = None


class NormalizeStats(BaseModel):
    node_count: int
    edge_count: int
    ingest_ms: float
    normalize_ms: float


class NormalizeResult(BaseModel):
    dataset: CanonicalDataset
    stats: NormalizeStats
    warnings: list[str]


def normalize_dataset(
    request: NormalizeRequest,
    *,
    expose_internal_schema: bool = False,
) -> NormalizeResult:
    """Parse input data and produce a validated deterministic canonical dataset."""
    ingest_start = time.perf_counter()
    _reject_reserved_metadata_keys(
        request.metadata_schema,
        request.metadata_by_node_id,
    )

    match request.format:
        case NormalizeFormat.NEWICK:
            parsed = parse_newick(request.content)
        case NormalizeFormat.EDGELIST:
            parsed = parse_edgelist(request.content)

        # If a invalid format is provided, raise a ParseError which will be handled by the caller to return a 400 response.
        case _:
            raise ParseError(ERR_UNSUPPORTED_FORMAT.format(format_name=request.format))

    ingest_ms = (time.perf_counter() - ingest_start) * 1000
    normalize_start = time.perf_counter()

    nodes = [CanonicalNode(id=node_id) for node_id in sorted(parsed.nodes)]
    warnings = list(parsed.warnings)

    edge_ids: dict[tuple[str, str], int] = {}
    canonical_edges: list[CanonicalEdge] = []
    for parsed_edge in sorted(
        parsed.edges, key=lambda edge: (edge.source, edge.target)
    ):
        source = parsed_edge.source
        target = parsed_edge.target
        distance = _normalize_edge_distance(
            parsed_edge.distance,
            source=source,
            target=target,
            warnings=warnings,
        )
        key = (source, target)
        edge_ids[key] = edge_ids.get(key, 0) + 1
        edge_id = EDGE_ID_TEMPLATE.format(
            source=source, target=target, count=edge_ids[key]
        )
        canonical_edges.append(
            CanonicalEdge(
                id=edge_id,
                source=source,
                target=target,
                distance=distance,
            )
        )

    declared_metadata_types = _declared_metadata_types(request.metadata_schema)
    metadata_by_node_id = _coerce_metadata_by_declared_schema(
        request.metadata_by_node_id,
        declared_metadata_types,
    )
    ancillary_rows_by_node_id: dict[
        str, list[dict[str, str | float | bool | None]]
    ] = {}
    if request.ancillary_data is not None:
        (
            ancillary_metadata,
            ancillary_rows_by_node_id,
            ancillary_warnings,
        ) = _parse_ancillary_metadata(
            request.ancillary_data,
            node_ids=_metadata_join_node_ids(
                request.format,
                nodes=nodes,
                edges=canonical_edges,
                explicit_node_ids=parsed.explicit_node_ids,
            ),
            declared_schema=request.metadata_schema,
        )
        metadata_by_node_id = {**metadata_by_node_id, **ancillary_metadata}
        warnings.extend(ancillary_warnings)

    metadata_schema = _merge_metadata_schema(
        request.metadata_schema,
        metadata_by_node_id,
    )
    metadata_by_node_id = _coerce_metadata_by_declared_schema(
        metadata_by_node_id,
        _declared_metadata_types(metadata_schema),
    )

    dataset = CanonicalDataset(
        dataset_id=request.dataset_name,
        nodes=nodes,
        edges=canonical_edges,
        metadata_schema=metadata_schema,
        metadata_by_node_id=metadata_by_node_id,
        ancillary_rows_by_node_id=ancillary_rows_by_node_id,
        source=DatasetSource(
            format=request.format.value,
            generated_at=datetime.now(UTC).isoformat(),
        ),
    )

    validate_canonical_dataset(
        dataset,
        allow_self_loops=request.options.allow_self_loops,
    )

    normalize_ms = (time.perf_counter() - normalize_start) * 1000
    stats = NormalizeStats(
        node_count=len(dataset.nodes),
        edge_count=len(dataset.edges),
        ingest_ms=round(ingest_ms, DEFAULT_ROUND_DECIMALS),
        normalize_ms=round(normalize_ms, DEFAULT_ROUND_DECIMALS),
    )

    return NormalizeResult(
        dataset=dataset
        if expose_internal_schema
        else public_metadata_schema_dataset(dataset),
        stats=stats,
        warnings=warnings,
    )


def _metadata_join_node_ids(
    format_name: NormalizeFormat,
    *,
    nodes: list[CanonicalNode],
    edges: list[CanonicalEdge],
    explicit_node_ids: set[str],
) -> set[str]:
    """Resolve node ids eligible for tabular metadata joins."""
    node_ids = {node.id for node in nodes}
    if format_name == NormalizeFormat.NEWICK:
        return explicit_node_ids & node_ids

    return node_ids


def _parse_ancillary_metadata(
    ancillary_data: AncillaryDataRequest,
    *,
    node_ids: set[str],
    declared_schema: list[MetadataField],
) -> tuple[
    dict[str, dict[str, str | float | bool | None]],
    dict[str, list[dict[str, str | float | bool | None]]],
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
    field_types.update(_declared_metadata_types(declared_schema))
    rows_by_node_id: dict[str, list[dict[str, str | float | bool | None]]] = {}
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

        rows_by_node_id.setdefault(node_id, []).append({
            key: _coerce_ancillary_value(value, field_types[key])
            for key, value in values.items()
        })

    metadata_by_node_id = {
        node_id: _aggregate_ancillary_rows(rows)
        for node_id, rows in rows_by_node_id.items()
    }

    missing_count = len(node_ids - set(metadata_by_node_id))
    if missing_count:
        warnings.append(
            WARN_ANCILLARY_UNMATCHED_NODE_COUNT.format(count=missing_count)
        )

    return metadata_by_node_id, rows_by_node_id, warnings


def _reject_reserved_metadata_keys(
    metadata_schema: list[MetadataField],
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]],
) -> None:
    for field in metadata_schema:
        _reject_reserved_metadata_key(field.key)

    for metadata in metadata_by_node_id.values():
        for key in metadata:
            _reject_reserved_metadata_key(key)


def _reject_reserved_ancillary_headers(headers: list[str], join_column: str) -> None:
    for header in headers:
        if header == join_column:
            continue
        _reject_reserved_metadata_key(header)


def _reject_reserved_metadata_key(key: str) -> None:
    if is_internal_metadata_key(key):
        raise ParseError(ERR_RESERVED_METADATA_KEY.format(key=key))


def _aggregate_ancillary_rows(
    rows: list[dict[str, str | float | bool | None]],
) -> dict[str, str | float | bool | None]:
    """Aggregate multiple isolate rows onto one profile/ST node."""
    metadata: dict[str, str | float | bool | None] = {
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
    values: list[str | float | bool | None],
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
    """Join raw table identifiers to canonical node ids using exact and slug matches."""
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
            field_types[key] = METADATA_TYPE_NULL
            continue
        if all(_is_boolean_literal(value) for value in values):
            field_types[key] = METADATA_TYPE_BOOLEAN
            continue
        if all(_is_number_literal(value) for value in values):
            field_types[key] = METADATA_TYPE_NUMBER
            continue
        field_types[key] = METADATA_TYPE_STRING
    return field_types


def _coerce_ancillary_value(
    value: str | None,
    metadata_type: str,
) -> str | float | bool | None:
    """Coerce one ancillary cell according to the inferred column type."""
    if value is None:
        return None
    if metadata_type == METADATA_TYPE_BOOLEAN:
        return value.lower() == "true"
    if metadata_type == METADATA_TYPE_NUMBER:
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


def _normalize_edge_distance(
    distance: float | None,
    *,
    source: str,
    target: str,
    warnings: list[str],
) -> float | None:
    if distance is None:
        return None
    if not isfinite(distance):
        raise ParseError(ERR_NONFINITE_DISTANCE.format(source=source, target=target))
    if distance < 0:
        warnings.append(
            WARN_NEGATIVE_DISTANCE_CLAMPED.format(
                distance=distance,
                source=source,
                target=target,
            )
        )
        return 0.0
    return distance


def _infer_metadata_schema(
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]],
) -> list[MetadataField]:
    """Infer metadata field types from node metadata dictionaries."""
    inferred: dict[str, str] = {}
    for metadata in metadata_by_node_id.values():
        for key, value in metadata.items():
            value_type = _detect_metadata_type(value)
            current = inferred.get(key)
            if current is None:
                inferred[key] = value_type
                continue
            if value_type == METADATA_TYPE_NULL:
                continue
            if current == METADATA_TYPE_NULL:
                inferred[key] = value_type
                continue
            if current != value_type:
                inferred[key] = METADATA_TYPE_STRING

    return [
        MetadataField(key=key, type=metadata_type)
        for key, metadata_type in sorted(inferred.items())
    ]


def _merge_metadata_schema(
    declared_schema: list[MetadataField],
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]],
) -> list[MetadataField]:
    """Preserve declared metadata fields while adding inferred fields for new keys."""
    inferred_schema = _infer_metadata_schema(metadata_by_node_id)
    if not declared_schema:
        return inferred_schema

    declared_keys = {field.key for field in declared_schema}
    inferred_additions = [
        field for field in inferred_schema if field.key not in declared_keys
    ]
    return [*declared_schema, *inferred_additions]


def _declared_metadata_types(declared_schema: list[MetadataField]) -> dict[str, str]:
    """Return caller-declared metadata types keyed by field name."""
    return {field.key: field.type.value for field in declared_schema}


def _coerce_metadata_by_declared_schema(
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]],
    declared_types: dict[str, str],
) -> dict[str, dict[str, str | float | bool | None]]:
    """Apply caller-declared scalar types to direct node metadata payloads."""
    if not declared_types:
        return dict(metadata_by_node_id)

    return {
        node_id: {
            key: _coerce_metadata_value_by_type(value, declared_types[key])
            if key in declared_types
            else value
            for key, value in metadata.items()
        }
        for node_id, metadata in metadata_by_node_id.items()
    }


def _coerce_metadata_value_by_type(
    value: str | float | bool | None,
    metadata_type: str,
) -> str | float | bool | None:
    if value is None:
        return None
    if metadata_type == METADATA_TYPE_STRING:
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    if metadata_type == METADATA_TYPE_NUMBER and isinstance(value, str):
        return _coerce_ancillary_value(value, metadata_type)
    if metadata_type == METADATA_TYPE_BOOLEAN and isinstance(value, str):
        return _coerce_ancillary_value(value, metadata_type)
    return value


def _detect_metadata_type(value: str | float | bool | None) -> str:
    """Map Python values to canonical metadata field types."""
    if value is None:
        return METADATA_TYPE_NULL
    if isinstance(value, bool):
        return METADATA_TYPE_BOOLEAN
    if isinstance(value, (int, float)):
        return METADATA_TYPE_NUMBER
    return METADATA_TYPE_STRING
