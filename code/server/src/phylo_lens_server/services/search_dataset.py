from __future__ import annotations

from phylo_lens_server.core.models import SearchDatasetQuery, SearchDatasetResponse
from phylo_lens_server.data.store import DatasetStore
from phylo_lens_server.services.search_index import (
    build_prepared_search_index,
    search_prepared_index,
)
from phylo_lens_server.services.visible_slice import PreparedDatasetNotFoundError


def search_dataset(
    query: SearchDatasetQuery,
    store: DatasetStore,
) -> SearchDatasetResponse:
    prepared = store.load(query.dataset_id)

    if prepared is None:
        raise PreparedDatasetNotFoundError(query.dataset_id)

    if prepared.search_index is None:
        prepared.search_index = build_prepared_search_index(prepared.dataset)
        store.save(prepared)

    return search_prepared_index(
        prepared.dataset.dataset_id,
        query,
        prepared.search_index,
    )
