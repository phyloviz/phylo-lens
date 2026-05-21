from __future__ import annotations

from math import isfinite
import time
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    MetadataField,
)
from phylo_lens_server.core.validators import validate_canonical_dataset
from phylo_lens_server.data.parsers import ParseError, parse_edgelist, parse_newick


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

ERR_UNSUPPORTED_FORMAT = "Unsupported format '{format_name}'."
ERR_NONFINITE_DISTANCE = "Edge distance on '{source}' -> '{target}' must be finite."
WARN_NEGATIVE_DISTANCE_CLAMPED = (
    "Negative edge distance {distance} on '{source}' -> '{target}' was clamped to 0.0."
)


class NormalizeOptions(BaseModel):
    allow_self_loops: bool = False


class NormalizeRequest(BaseModel):
    format: NormalizeFormat
    dataset_name: str = Field(default=DEFAULT_DATASET_NAME, min_length=1)
    content: str = Field(min_length=1)
    options: NormalizeOptions = Field(default_factory=NormalizeOptions)
    metadata_schema: list[MetadataField] = Field(default_factory=list)
    metadata_by_node_id: dict[str, dict[str, str | float | bool | None]] = Field(
        default_factory=dict
    )


class NormalizeStats(BaseModel):
    node_count: int
    edge_count: int
    ingest_ms: float
    normalize_ms: float


class NormalizeResult(BaseModel):
    dataset: CanonicalDataset
    stats: NormalizeStats
    warnings: list[str]


def normalize_dataset(request: NormalizeRequest) -> NormalizeResult:
    """Parse input data and produce a validated deterministic canonical dataset."""
    ingest_start = time.perf_counter()

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

    metadata_schema = request.metadata_schema
    if not metadata_schema:
        metadata_schema = _infer_metadata_schema(request.metadata_by_node_id)

    dataset = CanonicalDataset(
        dataset_id=request.dataset_name,
        nodes=nodes,
        edges=canonical_edges,
        metadata_schema=metadata_schema,
        metadata_by_node_id=request.metadata_by_node_id,
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
        dataset=dataset,
        stats=stats,
        warnings=warnings,
    )


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
            if current != value_type:
                inferred[key] = METADATA_TYPE_STRING

    return [
        MetadataField(key=key, type=metadata_type)
        for key, metadata_type in sorted(inferred.items())
    ]


def _detect_metadata_type(value: str | float | bool | None) -> str:
    """Map Python values to canonical metadata field types."""
    if value is None:
        return METADATA_TYPE_NULL
    if isinstance(value, bool):
        return METADATA_TYPE_BOOLEAN
    if isinstance(value, (int, float)):
        return METADATA_TYPE_NUMBER
    return METADATA_TYPE_STRING
