from math import isfinite

from phylo_lens_server.data.distance_connections import allelic_pairs, patristic_pairs
from phylo_lens_server.data.parsers import parse_newick_forest, slugify_label
from phylo_lens_server.data.typing_profiles import prepare_typing_profiles
from phylo_lens_server.domain.connections import (
    ConnectionLimitError,
    ConnectionQuery,
    ConnectionResult,
)
from phylo_lens_server.domain.models import GraphEdge, SourceFormat
from phylo_lens_server.repository.interfaces import LayoutRepository


def read_distance_connections(
    query: ConnectionQuery, store: LayoutRepository
) -> ConnectionResult:
    if not isfinite(query.threshold) or query.threshold < 0:
        raise ValueError("Connection threshold must be a finite nonnegative number.")
    if query.max_connections < 1:
        raise ValueError("Maximum connections must be a positive integer.")
    context = store.read_connection_context(query.dataset_id, query.layout_version)
    if query.format == SourceFormat.NEWICK:
        parsed = parse_newick_forest(query.content)
        source_ids = set(parsed.nodes)
        candidates = patristic_pairs(context, parsed.explicit_node_ids, query.threshold)
        metric = "patristic"
    else:
        if not float(query.threshold).is_integer():
            raise ValueError(
                "Allelic connection thresholds must be whole numbers of differing loci."
            )
        prepared = prepare_typing_profiles(query.content)
        members = prepared.membership()
        source_ids = set(members)
        rows = {slugify_label(row.identifier): row.alleles for row in prepared.rows}
        profiles = {node: rows[node] for node in members}
        candidates = allelic_pairs(
            profiles, int(query.threshold), context.node_components
        )
        metric = "allelic"
    if source_ids != set(context.node_components):
        raise ValueError(
            "The source does not match this prepared layout. Load the dataset again."
        )
    tree_pairs = {
        tuple(sorted((edge.source, edge.target))) for edge in context.tree_edges
    }
    edges = []
    for source, target, distance in candidates:
        if (source, target) in tree_pairs:
            continue
        if context.node_components[source] != context.node_components[target]:
            continue
        if len(edges) == query.max_connections:
            raise ConnectionLimitError(
                f"More than {query.max_connections:,} additional connections qualify. "
                "No partial overlay was applied. Reduce the distance threshold or increase the connection limit."
            )
        edges.append(
            GraphEdge(
                id=f"distance:{source}:{target}",
                source=source,
                target=target,
                distance=distance,
            )
        )
    return ConnectionResult(
        query.dataset_id,
        query.layout_version,
        metric,
        query.threshold,
        tuple(sorted(edges, key=lambda edge: edge.id)),
    )
