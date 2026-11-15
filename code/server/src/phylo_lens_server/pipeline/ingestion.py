from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from math import isfinite
from types import MappingProxyType

from phylo_lens_server.data.ancillary import (
    prepare_dataset_ancillary,
    validate_ancillary_input,
)
from phylo_lens_server.data.parsers import ParsedGraph, ParseError, parse_newick_forest
from phylo_lens_server.data.phylolib import (
    TypingNormalizeError,
    typing_profiles_to_rooted_forest,
)
from phylo_lens_server.data.typing_profiles import prepare_typing_profiles
from phylo_lens_server.domain.dataset import (
    GOEBURST_ROOTING_STRATEGY,
    NEWICK_ROOTING_STRATEGY,
    Dataset,
    DatasetSource,
    GraphEdge,
    GraphNode,
    SourceFormat,
)
from phylo_lens_server.domain.preparation import PrepareInput
from phylo_lens_server.domain.typing import FullMstOptions
from phylo_lens_server.domain.validators import validate_dataset
from phylo_lens_server.pipeline.distance_cutoff import cut_dataset

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
    validate_ancillary_input(
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
    graph_edges, distance_warnings = build_tree_edges(parsed)
    warnings = [*parsed.warnings, *distance_warnings]

    ancillary = prepare_dataset_ancillary(
        format_name=request.format,
        parsed=parsed,
        membership=membership,
        schema=request.ancillary_schema,
        by_node_id=request.ancillary_by_node_id,
        table=request.ancillary_data,
    )
    warnings.extend(ancillary.warnings)
    if source.distinct is not None:
        nodes = [GraphNode(id=node_id) for node_id in source.distinct.nodes]
        graph_edges = [
            GraphEdge(
                id=f"e_profile_{index}",
                source=edge.source,
                target=edge.target,
                distance=edge.distance,
            )
            for index, edge in enumerate(source.distinct.edges)
        ]

    dataset = Dataset(
        dataset_id=request.dataset_name,
        isolates_by_node_id=ancillary.isolates_by_node_id,
        nodes=nodes,
        edges=graph_edges,
        technical_roots=technical_roots,
        ancillary_schema=ancillary.ancillary_schema,
        summary_schema=ancillary.summary_schema,
        annotations_by_node_id=ancillary.annotations_by_node_id,
        ancillary_rows_by_node_id=ancillary.rows_by_node_id,
        source=DatasetSource(
            format=request.format.value,
            generated_at=datetime.now(UTC).isoformat(),
            provenance=typing_provenance,
            rooting_strategy=rooting_strategy,
            typing_options=request.typing_options,
        ),
    )

    validate_dataset(dataset)
    dataset = cut_dataset(dataset, request.distance_cutoff)
    if request.distance_cutoff is not None:
        warnings.append(
            f"Distance cutoff {request.distance_cutoff:g}: kept edges at or below "
            f"the cutoff; {len(dataset.technical_roots)} tree components."
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
class SourceForest:
    parsed: ParsedGraph
    distinct: ParsedGraph | None
    membership: Mapping[str, tuple[tuple[str, str], ...]]
    technical_roots: tuple[str, ...]
    rooting_strategy: str
    provenance: str | None


def read_source(request: PrepareInput) -> SourceForest:
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
                typing_tree = (
                    typing_profiles_to_rooted_forest(profiles)
                    if request.typing_options is None
                    or isinstance(request.typing_options, FullMstOptions)
                    else typing_profiles_to_rooted_forest(
                        profiles, request.typing_options
                    )
                )
            except TypingNormalizeError as error:
                raise ParseError(str(error)) from error
            parsed = typing_tree.parsed
            distinct = typing_tree.distinct
            technical_roots = typing_tree.roots
            # Preserve warning order without mutating the parsed tree.
            parsed = replace(parsed, warnings=(*parsed.warnings, *profiles.warnings))
        case _:
            raise ParseError(ERR_UNSUPPORTED_FORMAT.format(format_name=request.format))

    return SourceForest(
        parsed,
        distinct,
        MappingProxyType({key: tuple(value) for key, value in membership.items()}),
        technical_roots,
        rooting_strategy,
        typing_provenance,
    )


def build_tree_edges(parsed: ParsedGraph) -> tuple[list[GraphEdge], tuple[str, ...]]:
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
