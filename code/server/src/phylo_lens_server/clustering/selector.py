from __future__ import annotations

from phylo_lens_server.clustering.selection_policy import (
    resolve_max_nodes,
    select_cluster_view,
    target_level_for_query,
)
from phylo_lens_server.clustering.slice_builder import build_visible_slice_response
from phylo_lens_server.core.models import (
    CanonicalDataset,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
)

ERR_SELECTOR_DATASET_MISMATCH = (
    "Visible-slice query dataset '{query_dataset_id}' does not match "
    "hierarchy/dataset '{dataset_id}'."
)
TOPOLOGY_BUDGET_OVERFLOW_PERCENT = 12


class VisibleSliceSelectionError(ValueError):
    """Raised when a visible slice cannot be selected from the given inputs."""


def select_visible_slice(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> VisibleSliceResponse:
    """Select a deterministic visible slice from a threshold hierarchy."""
    validate_dataset_match(dataset, hierarchy, query)

    selection = select_cluster_view(
        dataset=dataset,
        hierarchy=hierarchy,
        query=query,
    )
    response = build_visible_slice_response(
        dataset=dataset,
        hierarchy=hierarchy,
        query=query,
        selection=selection,
    )
    if not should_try_coarser_level(
        query,
        response,
        resolve_max_nodes(dataset, query),
    ):
        return response

    for level in range(target_level_for_query(hierarchy, query) - 1, -1, -1):
        fallback_query = query.model_copy(update={"lod_hint": level})
        fallback_selection = select_cluster_view(
            dataset=dataset,
            hierarchy=hierarchy,
            query=fallback_query,
        )
        fallback_response = build_visible_slice_response(
            dataset=dataset,
            hierarchy=hierarchy,
            query=fallback_query,
            selection=fallback_selection,
        )
        if len(fallback_response.nodes) <= resolve_max_nodes(dataset, query):
            return fallback_response

    return response


def should_try_coarser_level(
    query: VisibleSliceQuery,
    response: VisibleSliceResponse,
    max_nodes: int,
) -> bool:
    return (
        len(response.nodes) > topology_budget_limit(max_nodes)
        and query.lod_hint is None
        and query.focus_node_id is None
        and query.focus_cluster_id is None
        and not query.expanded_cluster_ids
    )


def topology_budget_limit(max_nodes: int) -> int:
    """Allow modest skeleton expansion before dropping several LoD levels."""
    return max(
        max_nodes,
        max_nodes
        + (
            max_nodes * TOPOLOGY_BUDGET_OVERFLOW_PERCENT
            + 99
        )
        // 100,
    )


def validate_dataset_match(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> None:
    if (
        dataset.dataset_id == hierarchy.dataset_id
        and query.dataset_id == dataset.dataset_id
    ):
        return

    raise VisibleSliceSelectionError(
        ERR_SELECTOR_DATASET_MISMATCH.format(
            query_dataset_id=query.dataset_id,
            dataset_id=dataset.dataset_id,
        )
    )
