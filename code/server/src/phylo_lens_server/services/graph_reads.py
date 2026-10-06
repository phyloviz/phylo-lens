from dataclasses import replace

from phylo_lens_server.domain.search import SearchQuery, SearchReadResult
from phylo_lens_server.domain.views import (
    RegionQuery,
    RegionReadResult,
    ViewportQuery,
    ViewportReadResult,
    select_viewport_lod_level,
)
from phylo_lens_server.repository.interfaces import LayoutRepository


class PreparedLayoutNotFoundError(LookupError):
    """Raised when a dataset has no published prepared layout."""


def read_graph_viewport(
    query: ViewportQuery,
    store: LayoutRepository,
) -> ViewportReadResult:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    lod_level = effective_lod_level(query)
    if query.lod_target_representations is not None and query.cluster_id is None:
        bounds = query.lod_selection_bounds or query
        counts = store.viewport_representation_counts(
            dataset_id=query.dataset_id,
            layout_version=layout_version,
            xmin=bounds.xmin,
            xmax=bounds.xmax,
            ymin=bounds.ymin,
            ymax=bounds.ymax,
        )
        if counts:
            semantic_level = (
                min(lod_level, max(counts)) if lod_level is not None else max(counts)
            )
            lod_level = select_viewport_lod_level(
                counts,
                semantic_level,
                query.lod_target_representations,
                query.previous_lod_level,
            )

    result = store.read_viewport(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        xmin=query.xmin,
        xmax=query.xmax,
        ymin=query.ymin,
        ymax=query.ymax,
        max_nodes=query.max_nodes,
        lod_level=lod_level,
        cluster_id=query.cluster_id,
        focus_node_id=query.focus_node_id,
    )
    return replace(result, lod_level=lod_level, zoom=query.zoom)


def read_graph_region(
    query: RegionQuery,
    store: LayoutRepository,
) -> RegionReadResult:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    result = store.read_region(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        xmin=query.xmin,
        xmax=query.xmax,
        ymin=query.ymin,
        ymax=query.ymax,
        max_nodes=query.max_nodes,
    )
    return result


def search_graph_nodes(
    query: SearchQuery,
    store: LayoutRepository,
) -> SearchReadResult:
    layout_version = resolve_layout_version(
        store, query.dataset_id, query.layout_version
    )
    result = store.search_nodes(
        dataset_id=query.dataset_id,
        layout_version=layout_version,
        query=query.query,
        limit=query.limit,
    )
    return result


def effective_lod_level(query: ViewportQuery) -> int | None:
    if query.lod_level is not None:
        return query.lod_level
    if query.zoom < 1.0:
        return 0
    return None


def resolve_layout_version(
    store: LayoutRepository,
    dataset_id: str,
    layout_version: str | None,
) -> str:
    resolved = layout_version or store.latest_layout_version(dataset_id)
    if resolved is None:
        raise PreparedLayoutNotFoundError(dataset_id)
    return resolved
