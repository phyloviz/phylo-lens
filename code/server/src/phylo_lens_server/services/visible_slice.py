from __future__ import annotations

from phylo_lens_server.clustering.selector import select_visible_slice
from phylo_lens_server.core.models import VisibleSliceQuery, VisibleSliceResponse
from phylo_lens_server.data.store import DatasetStore

ERR_DATASET_NOT_FOUND = "Prepared dataset '{dataset_id}' was not found."


class PreparedDatasetNotFoundError(Exception):
    """Raised when a visible-slice query references an unknown prepared dataset."""

    def __init__(self, dataset_id: str) -> None:
        self.dataset_id = dataset_id
        super().__init__(ERR_DATASET_NOT_FOUND.format(dataset_id=dataset_id))


def get_visible_slice(
    query: VisibleSliceQuery,
    store: DatasetStore,
) -> VisibleSliceResponse:
    prepared = store.load(query.dataset_id)

    if prepared is None:
        raise PreparedDatasetNotFoundError(query.dataset_id)

    return select_visible_slice(
        prepared.dataset,
        prepared.hierarchy,
        query,
    )
