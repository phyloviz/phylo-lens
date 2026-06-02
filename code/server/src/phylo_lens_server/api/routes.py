from __future__ import annotations

import os
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from fastapi.params import Depends
from pydantic import ValidationError

from phylo_lens_server.api.errors import (
    domain_validation_error_to_http,
    not_found_error,
    parse_error_to_http,
    pydantic_validation_error_to_http,
    threshold_hierarchy_error_to_http,
    unexpected_server_error,
    visible_slice_error_to_http,
)
from phylo_lens_server.clustering.selector import VisibleSliceSelectionError
from phylo_lens_server.clustering.threshold_hierarchy import (
    ThresholdHierarchyBuildError,
)
from phylo_lens_server.core.models import (
    DomainValidationError,
    PrepareDatasetResult,
    SearchDatasetQuery,
    SearchDatasetResponse,
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
from phylo_lens_server.services.prepare_dataset import prepare_dataset_for_lod
from phylo_lens_server.services.search_dataset import search_dataset
from phylo_lens_server.services.visible_slice import (
    PreparedDatasetNotFoundError,
    get_visible_slice,
)

ROUTER_PREFIX = "/dataset"
ROUTER_TAG = "dataset"

ROUTE_NORMALIZE = "/normalize"
ROUTE_PREPARE = "/prepare"
ROUTE_SEARCH = "/search"
ROUTE_VIEW_SLICE = "/view-slice"

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
        raise parse_error_to_http(exc) from exc
    except DomainValidationError as exc:
        raise domain_validation_error_to_http(exc) from exc
    except ValidationError as exc:
        raise pydantic_validation_error_to_http(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


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
        return prepare_dataset_for_lod(request, store)
    except ParseError as exc:
        raise parse_error_to_http(exc) from exc
    except DomainValidationError as exc:
        raise domain_validation_error_to_http(exc) from exc
    except ThresholdHierarchyBuildError as exc:
        raise threshold_hierarchy_error_to_http(exc) from exc
    except ValidationError as exc:
        raise pydantic_validation_error_to_http(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


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
        return get_visible_slice(query, store)
    except PreparedDatasetNotFoundError as exc:
        raise not_found_error(str(exc)) from exc
    except VisibleSliceSelectionError as exc:
        raise visible_slice_error_to_http(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc


@router.post(
    ROUTE_SEARCH,
    response_model=SearchDatasetResponse,
    response_model_exclude_none=True,
)
def search(
    query: SearchDatasetQuery,
    store: DatasetStore = Depends(get_dataset_store),
) -> SearchDatasetResponse:
    """Search nodes and metadata in one prepared dataset."""
    try:
        return search_dataset(query, store)
    except PreparedDatasetNotFoundError as exc:
        raise not_found_error(str(exc)) from exc
    except ValidationError as exc:
        raise pydantic_validation_error_to_http(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise unexpected_server_error(exc) from exc
