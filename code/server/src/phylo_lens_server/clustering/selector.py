from __future__ import annotations

from phylo_lens_server.clustering.selection_policy import select_cluster_view
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

    return build_visible_slice_response(
        dataset=dataset,
        hierarchy=hierarchy,
        query=query,
        selection=selection,
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
