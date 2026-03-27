from __future__ import annotations

from fastapi import APIRouter, HTTPException

from phylo_lens_server.core.models import DomainValidationError
from phylo_lens_server.data.normalizer import (
    NormalizeRequest,
    NormalizeResult,
    normalize_dataset,
)
from phylo_lens_server.data.parsers import ParseError

ROUTER_PREFIX = "/dataset"
ROUTER_TAG = "dataset"
ROUTE_NORMALIZE = "/normalize"

STATUS_BAD_REQUEST = 400
STATUS_UNPROCESSABLE_ENTITY = 422
STATUS_INTERNAL_SERVER_ERROR = 500

ERR_UNEXPECTED_SERVER = "Unexpected server error"

router = APIRouter(prefix=ROUTER_PREFIX, tags=[ROUTER_TAG])


@router.post(ROUTE_NORMALIZE, response_model=NormalizeResult)
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
