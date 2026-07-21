from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from phylo_lens_server.http.graph.dependencies import (
    shutdown_prepare_job_registry_if_started,
)
from phylo_lens_server.http.graph.router import router as graph_router
from phylo_lens_server.utils.versions import API_VERSION, service_version

PACKAGE_LOGGER_NAME = "phylo_lens_server"


def configure_logging() -> None:
    """Emit the package's INFO logs to the console.

    Uvicorn configures its own loggers but never attaches a handler to the
    ``phylo_lens_server`` logger, so app-level ``logger.info(...)`` calls (e.g.
    the viewport read/serialize timings) are otherwise dropped. Attach a single
    stream handler once, and stop propagation so the record is not also emitted
    by any root handler uvicorn may have installed.
    """
    package_logger = logging.getLogger(PACKAGE_LOGGER_NAME)
    if package_logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    package_logger.addHandler(handler)
    package_logger.setLevel(logging.INFO)
    package_logger.propagate = False


APP_TITLE = "PhyloLens Server"

ROUTE_HEALTH = "/health"
HEALTH_STATUS_KEY = "status"
HEALTH_STATUS_VALUE_OK = "ok"
HEALTH_SERVICE_VERSION_KEY = "service_version"
HEALTH_API_VERSION_KEY = "api_version"

UVICORN_HOST = "127.0.0.1"
UVICORN_PORT = 8000
UVICORN_RELOAD = True
UVICORN_APP = "phylo_lens_server.main:app"

ENV_CORS_ORIGINS = "PHYLO_LENS_CORS_ORIGINS"
ALLOWED_CORS_METHODS = ["GET", "POST"]
ALLOWED_CORS_HEADERS = ["Content-Type"]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Shut down the background prepare worker cleanly on app shutdown."""
    try:
        yield
    finally:
        shutdown_prepare_job_registry_if_started()


configure_logging()


def parse_cors_origins(raw_origins: str | None = None) -> list[str]:
    """Parse a comma-separated CORS origin list from deployment config."""
    value = os.environ.get(ENV_CORS_ORIGINS, "") if raw_origins is None else raw_origins

    return [origin.strip() for origin in value.split(",") if origin.strip()]


def create_app() -> FastAPI:
    app = FastAPI(title=APP_TITLE, version=service_version(), lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=parse_cors_origins(),
        allow_credentials=False,
        allow_methods=ALLOWED_CORS_METHODS,
        allow_headers=ALLOWED_CORS_HEADERS,
    )

    app.include_router(graph_router)

    app.get(ROUTE_HEALTH)(health)

    return app


def health() -> dict[str, str]:
    """Return a basic liveness signal for local and CI checks."""
    return {
        HEALTH_STATUS_KEY: HEALTH_STATUS_VALUE_OK,
        HEALTH_SERVICE_VERSION_KEY: service_version(),
        HEALTH_API_VERSION_KEY: API_VERSION,
    }


app = create_app()


def run() -> None:
    """Run the local development server with reload enabled."""
    uvicorn.run(
        UVICORN_APP,
        host=UVICORN_HOST,
        port=UVICORN_PORT,
        reload=UVICORN_RELOAD,
    )
