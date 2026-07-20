import os

import uvicorn

from phylo_lens_server.main import UVICORN_APP

ENV_HOST = "PHYLO_LENS_HOST"
ENV_PORT = "PHYLO_LENS_PORT"
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000


def main() -> None:
    """Run the production ASGI service without development reload."""
    uvicorn.run(
        UVICORN_APP,
        host=os.environ.get(ENV_HOST, DEFAULT_HOST),
        port=int(os.environ.get(ENV_PORT, str(DEFAULT_PORT))),
        reload=False,
    )


if __name__ == "__main__":
    main()
