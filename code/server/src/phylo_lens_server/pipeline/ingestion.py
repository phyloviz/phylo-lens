from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from math import isfinite
from types import MappingProxyType

from phylo_lens_server.data.ancillary import (
    ANCILLARY_TYPE_BOOLEAN,
    ANCILLARY_TYPE_NUMBER,
    _aggregate_ancillary_rows,
    _ancillary_join_node_ids,
    _coerce_ancillary_by_declared_schema,
    _declared_ancillary_types,
    _merge_annotation_schema,
    _merge_node_ancillary_data,
    _parse_ancillary_data,
    _reject_reserved_ancillary_keys,
)
from phylo_lens_server.data.parsers import ParsedGraph, ParseError, parse_newick_forest
from phylo_lens_server.data.phylolib import (
    TypingNormalizeError,
    typing_profiles_to_rooted_tree,
)
from phylo_lens_server.data.typing_profiles import prepare_typing_profiles
from phylo_lens_server.domain.ancillary import AncillaryData
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.models import (
    GOEBURST_ROOTING_STRATEGY,
    NEWICK_ROOTING_STRATEGY,
    Dataset,
    DatasetSource,
    GraphEdge,
    GraphNode,
    Isolate,
    SourceFormat,
)
from phylo_lens_server.domain.preparation import PrepareInput
from phylo_lens_server.domain.validators import validate_dataset

DEFAULT_ROUND_DECIMALS = 3
EDGE_ID_TEMPLATE = "e_{source}_{target}_{count}"
ERR_UNSUPPORTED_FORMAT = "Unsupported format '{format_name}'."
ERR_NONFINITE_DISTANCE = "Edge distance on '{source}' -> '{target}' must be finite."
WARN_NEGATIVE_DISTANCE_CLAMPED = (
    "Negative edge distance {distance} on '{source}' -> '{target}' was clamped to 0.0."
)


@dataclass(frozen=True)
class IngestionStats:
    node_count: int
    edge_count: int
    ingest_ms: float
    normalize_ms: float


@dataclass(frozen=True)
class IngestionResult:
    dataset: Dataset
    stats: IngestionStats
    warnings: tuple[str, ...]


def ingest_dataset(
    request: PrepareInput,
    *,
    include_summary_schema: bool = False,
) -> IngestionResult:
    """Parse input data and produce a validated dataset."""
    ingest_start = time.perf_counter()
    _reject_reserved_ancillary_keys(
        request.ancillary_schema,
        request.ancillary_by_node_id,
    )

    source = read_source(request)
    parsed, membership = source.parsed, source.membership
    technical_roots, rooting_strategy = source.technical_roots, source.rooting_strategy
    typing_provenance = source.provenance

    ingest_ms = (time.perf_counter() - ingest_start) * 1000
    normalize_start = time.perf_counter()

    nodes = [GraphNode(id=node_id) for node_id in sorted(parsed.nodes)]
    graph_edges, distance_warnings = build_graph_edges(parsed)
    warnings = [*parsed.warnings, *distance_warnings]

    declared_ancillary_types = _declared_ancillary_types(request.ancillary_schema)
    original_ids = {
        original: normalized
        for members in membership.values()
        for original, normalized in members
    }
    direct_metadata = {
        original_ids.get(key, key): value
        for key, value in request.ancillary_by_node_id.items()
    }
    if len(direct_metadata) != len(request.ancillary_by_node_id):
        raise ParseError("Direct metadata identifies the same isolate more than once.")
    metadata_by_node_id = _coerce_ancillary_by_declared_schema(
        direct_metadata,
        declared_ancillary_types,
    )
    ancillary_rows_by_node_id: dict[str, list[AncillaryData]] = {}
    if request.ancillary_data is not None:
        (
            ancillary_metadata,
            ancillary_rows_by_node_id,
            ancillary_warnings,
        ) = _parse_ancillary_data(
            request.ancillary_data,
            node_ids=_ancillary_join_node_ids(
                request.format,
                nodes=nodes,
                explicit_node_ids=parsed.explicit_node_ids,
            ),
            declared_schema=request.ancillary_schema,
        )
        metadata_by_node_id = _merge_node_ancillary_data(
            metadata_by_node_id,
            ancillary_metadata,
        )
        warnings.extend(ancillary_warnings)

    isolates_by_node_id: dict[str, list[Isolate]] = {}
    if membership:
        if set(metadata_by_node_id) - set(parsed.nodes):
            raise ParseError("Typing metadata references an unknown isolate.")
        for node_id, members in membership.items():
            isolates = []
            for original_id, normalized_id in members:
                if len(ancillary_rows_by_node_id.get(normalized_id, [])) > 1:
                    raise ParseError(
                        "Typing ancillary data must contain at most one row per isolate ID."
                    )
                isolate_data = {
                    key: value
                    for key, value in metadata_by_node_id.get(normalized_id, {}).items()
                    if not is_summary_key(key)
                }
                isolates.append(Isolate(id=original_id, ancillary_data=isolate_data))
            isolates_by_node_id[node_id] = isolates
        grouped = source.distinct
        assert grouped is not None
        nodes = [GraphNode(id=node_id) for node_id in grouped.nodes]
        graph_edges = [
            GraphEdge(
                id=f"e_profile_{index}",
                source=edge.source,
                target=edge.target,
                distance=edge.distance,
            )
            for index, edge in enumerate(grouped.edges)
        ]
        ancillary_rows_by_node_id = {
            node_id: [isolate.ancillary_data for isolate in isolates]
            for node_id, isolates in isolates_by_node_id.items()
        }
        metadata_by_node_id = {
            node_id: _aggregate_ancillary_rows(rows)
            for node_id, rows in ancillary_rows_by_node_id.items()
        }
        # Keep declared scalar summaries valid without losing original values
        # in per-isolate records and categorical counts.
        for node_id, rows in ancillary_rows_by_node_id.items():
            for key, field_type in declared_ancillary_types.items():
                values = [row[key] for row in rows if row.get(key) is not None]
                if not values:
                    continue
                if field_type == ANCILLARY_TYPE_NUMBER:
                    metadata_by_node_id[node_id][key] = sum(values) / len(values)
                elif field_type == ANCILLARY_TYPE_BOOLEAN and len(set(values)) > 1:
                    metadata_by_node_id[node_id][key] = None

    metadata_schema = _merge_annotation_schema(
        request.ancillary_schema,
        metadata_by_node_id,
    )
    metadata_by_node_id = _coerce_ancillary_by_declared_schema(
        metadata_by_node_id,
        _declared_ancillary_types(metadata_schema),
    )

    dataset = Dataset(
        dataset_id=request.dataset_name,
        isolates_by_node_id=isolates_by_node_id,
        nodes=nodes,
        edges=graph_edges,
        technical_roots=technical_roots,
        ancillary_schema=[
            field for field in metadata_schema if not is_summary_key(field.key)
        ],
        summary_schema=[
            field for field in metadata_schema if is_summary_key(field.key)
        ],
        annotations_by_node_id={
            node_id: decode_node_annotations(values)
            for node_id, values in metadata_by_node_id.items()
        },
        ancillary_rows_by_node_id=ancillary_rows_by_node_id,
        source=DatasetSource(
            format=request.format.value,
            generated_at=datetime.now(UTC).isoformat(),
            provenance=typing_provenance,
            rooting_strategy=rooting_strategy,
        ),
    )

    validate_dataset(
        dataset,
        allow_self_loops=request.options.allow_self_loops,
    )

    normalize_ms = (time.perf_counter() - normalize_start) * 1000
    stats = IngestionStats(
        node_count=len(dataset.nodes),
        edge_count=len(dataset.edges),
        ingest_ms=round(ingest_ms, DEFAULT_ROUND_DECIMALS),
        normalize_ms=round(normalize_ms, DEFAULT_ROUND_DECIMALS),
    )

    return IngestionResult(
        dataset=(
            dataset
            if include_summary_schema
            else dataset.model_copy(update={"summary_schema": ()})
        ),
        stats=stats,
        warnings=tuple(warnings),
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


@dataclass(frozen=True)
class SourceGraph:
    parsed: ParsedGraph
    distinct: ParsedGraph | None
    membership: Mapping[str, tuple[tuple[str, str], ...]]
    technical_roots: tuple[str, ...]
    rooting_strategy: str
    provenance: str | None


def read_source(request: PrepareInput) -> SourceGraph:
    typing_provenance: str | None = None
    distinct: ParsedGraph | None = None
    membership: dict[str, list[tuple[str, str]]] = {}
    match request.format:
        case SourceFormat.NEWICK:
            parsed = parse_newick_forest(request.content)
            technical_roots = parsed.component_roots
            rooting_strategy = NEWICK_ROOTING_STRATEGY
        case SourceFormat.TYPING_DATA:
            profiles = prepare_typing_profiles(request.content)
            membership = profiles.membership()
            typing_provenance = profiles.provenance
            rooting_strategy = GOEBURST_ROOTING_STRATEGY
            try:
                typing_tree = typing_profiles_to_rooted_tree(profiles)
            except TypingNormalizeError as error:
                raise ParseError(str(error)) from error
            parsed = typing_tree.parsed
            distinct = typing_tree.distinct
            technical_roots = (typing_tree.root,)
            # Preserve warning order without mutating the parsed tree.
            parsed = replace(parsed, warnings=(*parsed.warnings, *profiles.warnings))
        case _:
            raise ParseError(ERR_UNSUPPORTED_FORMAT.format(format_name=request.format))

    return SourceGraph(
        parsed,
        distinct,
        MappingProxyType({key: tuple(value) for key, value in membership.items()}),
        technical_roots,
        rooting_strategy,
        typing_provenance,
    )


def build_graph_edges(parsed: ParsedGraph) -> tuple[list[GraphEdge], tuple[str, ...]]:
    warnings: list[str] = []

    edge_ids: dict[tuple[str, str], int] = {}
    graph_edges: list[GraphEdge] = []
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
        graph_edges.append(
            GraphEdge(
                id=edge_id,
                source=source,
                target=target,
                distance=distance,
            )
        )

    return graph_edges, tuple(warnings)
