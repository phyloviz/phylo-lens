from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "code" / "server" / "src"


def bootstrap_server_src() -> None:
    """Make the server package importable when profiling from a checkout."""
    if str(SERVER_SRC) not in sys.path:
        sys.path.insert(0, str(SERVER_SRC))

