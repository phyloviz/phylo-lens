from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from phylo_lens_server.api.v2_graph import router as graph_v2_router

APP_TITLE = "PhyloLens Server"
APP_VERSION = "0.1.0"

ROUTE_HEALTH = "/health"
HEALTH_STATUS_KEY = "status"
HEALTH_STATUS_VALUE_OK = "ok"

UVICORN_HOST = "127.0.0.1"
UVICORN_PORT = 8000
UVICORN_RELOAD = True
UVICORN_APP = "phylo_lens_server.main:app"

CLIENT_ORIGIN_LOCALHOST_5173 = "http://localhost:5173"
CLIENT_ORIGIN_LOOPBACK_5173 = "http://127.0.0.1:5173"
CLIENT_ORIGIN_LOCALHOST_3000 = "http://localhost:3000"
CLIENT_ORIGIN_LOOPBACK_3000 = "http://127.0.0.1:3000"
CLIENT_ORIGIN_LOCALHOST_4173 = "http://localhost:4173"
CLIENT_ORIGIN_LOOPBACK_4173 = "http://127.0.0.1:4173"

ALLOWED_ORIGINS = [
    CLIENT_ORIGIN_LOCALHOST_3000,
    CLIENT_ORIGIN_LOOPBACK_3000,
    CLIENT_ORIGIN_LOCALHOST_5173,
    CLIENT_ORIGIN_LOOPBACK_5173,
    CLIENT_ORIGIN_LOCALHOST_4173,
    CLIENT_ORIGIN_LOOPBACK_4173,
]

app = FastAPI(title=APP_TITLE, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_v2_router)


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
