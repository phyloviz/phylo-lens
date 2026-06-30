import logging

from fastapi import HTTPException
from pydantic import ValidationError

from phylo_lens_server.core.models import DomainValidationError
from phylo_lens_server.data.parsers import ParseError

STATUS_BAD_REQUEST = 400
STATUS_NOT_FOUND = 404
STATUS_UNPROCESSABLE_ENTITY = 422
STATUS_INTERNAL_SERVER_ERROR = 500

ERR_UNEXPECTED_SERVER = "Unexpected server error"

logger = logging.getLogger(__name__)


def parse_error_to_http(exc: ParseError) -> HTTPException:
    return HTTPException(
        status_code=STATUS_BAD_REQUEST,
        detail=str(exc),
    )


def domain_validation_error_to_http(exc: DomainValidationError) -> HTTPException:
    return HTTPException(
        status_code=STATUS_UNPROCESSABLE_ENTITY,
        detail={"errors": exc.errors},
    )


def pydantic_validation_error_to_http(exc: ValidationError) -> HTTPException:
    return HTTPException(
        status_code=STATUS_UNPROCESSABLE_ENTITY,
        detail={"errors": exc.errors()},
    )


def not_found_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=STATUS_NOT_FOUND,
        detail=message,
    )


def unexpected_server_error(exc: Exception) -> HTTPException:
    logger.exception("%s: %s", ERR_UNEXPECTED_SERVER, exc)
    return HTTPException(
        status_code=STATUS_INTERNAL_SERVER_ERROR,
        detail=ERR_UNEXPECTED_SERVER,
    )
