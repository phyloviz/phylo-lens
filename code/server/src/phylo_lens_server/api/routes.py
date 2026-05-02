from __future__ import annotations

import os
import time
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from fastapi.params import Depends

from phylo_lens_server.clustering.threshold_hierarchy import (
    ThresholdHierarchyBuildError,
    build_threshold_hierarchy,
)
from phylo_lens_server.clustering.selector import (
    VisibleSliceSelectionError,
    select_visible_slice,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    DomainValidationError,
    PrepareDatasetResult,
    PrepareDatasetStats,
    PreparedDatasetRecord,
    SourceFormat,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
)
from phylo_lens_server.data.normalizer import (
    NormalizeRequest,
    NormalizeResult,
    normalize_dataset,
)
from phylo_lens_server.data.parsers import ParseError
from phylo_lens_server.data.store import DatasetStore

ROUTER_PREFIX = "/dataset"
ROUTER_TAG = "dataset"
ROUTE_NORMALIZE = "/normalize"
ROUTE_PREPARE = "/prepare"
ROUTE_VIEW_SLICE = "/view-slice"

STATUS_BAD_REQUEST = 400
STATUS_NOT_FOUND = 404
STATUS_UNPROCESSABLE_ENTITY = 422
STATUS_INTERNAL_SERVER_ERROR = 500

ERR_UNEXPECTED_SERVER = "Unexpected server error"
ERR_DATASET_NOT_FOUND = "Prepared dataset '{dataset_id}' was not found."
ERR_THRESHOLD_ONLY_PREPARE = (
    "Prepare currently supports only weighted datasets with distances for the "
    "distance-threshold hierarchy path."
)
ENV_STORE_DIR = "PHYLO_LENS_STORE_DIR"

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])


@lru_cache(maxsize=1)
def get_dataset_store() -> DatasetStore:
    """Provide a reusable prepared-dataset store for API handlers."""
    return DatasetStore(os.environ.get(ENV_STORE_DIR))


@router.post(
    ROUTE_NORMALIZE,
    response_model=NormalizeResult,
    response_model_exclude_none=True,
)
def normalize(request: NormalizeRequest) -> NormalizeResult:
    """Normalize raw dataset payloads into canonical validated contracts."""
    try:
        return normalize_dataset(request)
    except ParseError as exc:
        raise HTTPException(status_code=STATUS_BAD_REQUEST, detail=str(exc)) from exc
    except DomainValidationError as exc:
        raise HTTPException(
            status_code=STATUS_UNPROCESSABLE_ENTITY,
            detail={"errors": exc.errors},
        ) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=STATUS_INTERNAL_SERVER_ERROR,
            detail=ERR_UNEXPECTED_SERVER,
        ) from exc


@router.post(
    ROUTE_PREPARE,
    response_model=PrepareDatasetResult,
    response_model_exclude_none=True,
)
def prepare_dataset(
    request: NormalizeRequest,
    store: DatasetStore = Depends(get_dataset_store),
) -> PrepareDatasetResult:
    """Normalize, build hierarchy, and persist one dataset for LoD queries."""
    try:
        normalized = normalize_dataset(request)

        hierarchy_start = time.perf_counter()
        prepared_dataset, hierarchy = _build_prepared_hierarchy(normalized.dataset)
        hierarchy_ms = (time.perf_counter() - hierarchy_start) * 1000

        store_start = time.perf_counter()
        store.save(
            PreparedDatasetRecord(
                dataset=prepared_dataset,
                hierarchy=hierarchy,
                warnings=normalized.warnings,
            )
        )
        store_ms = (time.perf_counter() - store_start) * 1000

        return PrepareDatasetResult(
            dataset_id=prepared_dataset.dataset_id,
            stats=PrepareDatasetStats(
                node_count=len(prepared_dataset.nodes),
                edge_count=len(prepared_dataset.edges),
                ingest_ms=normalized.stats.ingest_ms,
                normalize_ms=normalized.stats.normalize_ms,
                hierarchy_ms=round(hierarchy_ms, 3),
                store_ms=round(store_ms, 3),
            ),
            warnings=normalized.warnings,
        )
    except ParseError as exc:
        raise HTTPException(status_code=STATUS_BAD_REQUEST, detail=str(exc)) from exc
    except (DomainValidationError, ThresholdHierarchyBuildError) as exc:
        detail = {"errors": exc.errors} if isinstance(exc, DomainValidationError) else str(exc)
        raise HTTPException(
            status_code=STATUS_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=STATUS_INTERNAL_SERVER_ERROR,
            detail=ERR_UNEXPECTED_SERVER,
        ) from exc


def _build_prepared_hierarchy(
    dataset: CanonicalDataset,
) -> tuple[CanonicalDataset, ThresholdHierarchyIndex]:
    if not _should_use_distance_threshold_hierarchy(dataset):
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_ONLY_PREPARE)
    return dataset, build_threshold_hierarchy(dataset)


def _should_use_distance_threshold_hierarchy(dataset: CanonicalDataset) -> bool:
    if dataset.source.format is SourceFormat.TYPING_DATA:
        return False

    return (
        len(dataset.edges) > 0
        and all(edge.distance is not None for edge in dataset.edges)
    )


@router.post(
    ROUTE_VIEW_SLICE,
    response_model=VisibleSliceResponse,
    response_model_exclude_none=True,
)
def view_slice(
    query: VisibleSliceQuery,
    store: DatasetStore = Depends(get_dataset_store),
) -> VisibleSliceResponse:
    """Return a bounded visible slice for one prepared dataset."""
    try:
        prepared = store.load(query.dataset_id)
        if prepared is None:
            raise HTTPException(
                status_code=STATUS_NOT_FOUND,
                detail=ERR_DATASET_NOT_FOUND.format(dataset_id=query.dataset_id),
            )
        return select_visible_slice(prepared.dataset, prepared.hierarchy, query)
    except HTTPException:
        raise
    except VisibleSliceSelectionError as exc:
        raise HTTPException(status_code=STATUS_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=STATUS_INTERNAL_SERVER_ERROR,
            detail=ERR_UNEXPECTED_SERVER,
        ) from exc
