from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from phylo_lens_server.api.graph import (
    get_prepare_job_registry,
    router as graph_router,
)

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
APP_VERSION = "0.1.0"

ROUTE_HEALTH = "/health"
HEALTH_STATUS_KEY = "status"
HEALTH_STATUS_VALUE_OK = "ok"

UVICORN_HOST = "127.0.0.1"
UVICORN_PORT = 8000
UVICORN_RELOAD = True
UVICORN_APP = "phylo_lens_server.main:app"

CLIENT_ORIGIN_LOCALHOST_3000 = "http://localhost:3000"
CLIENT_ORIGIN_LOOPBACK_3000 = "http://127.0.0.1:3000"

ALLOWED_ORIGINS = [
    CLIENT_ORIGIN_LOCALHOST_3000,
    CLIENT_ORIGIN_LOOPBACK_3000,
]


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Shut down the background prepare worker cleanly on app shutdown."""
    try:
        yield
    finally:
        get_prepare_job_registry().shutdown()


configure_logging()

app = FastAPI(title=APP_TITLE, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)


@app.get(ROUTE_HEALTH)
def health() -> dict[str, str]:
    """Return a basic liveness signal for local and CI checks."""
    return {HEALTH_STATUS_KEY: HEALTH_STATUS_VALUE_OK}


def run() -> None:
    """Run the local development server with reload enabled."""
    uvicorn.run(
        UVICORN_APP,
        host=UVICORN_HOST,
        port=UVICORN_PORT,
        reload=UVICORN_RELOAD,
    )
