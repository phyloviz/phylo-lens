from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from tempfile import gettempdir

from phylo_lens_server.prepared_layout.jobs import PrepareJobRegistry
from phylo_lens_server.prepared_layout.store.prepared_layout_store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker

ENV_PREPARED_LAYOUT_STORE_DIR = "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR"
DEFAULT_PREPARED_LAYOUT_STORE_DIR = Path(gettempdir()) / "phylo_lens_prepared_layout"


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> PreparedLayoutStore:
    return PreparedLayoutStore(
        os.environ.get(
            ENV_PREPARED_LAYOUT_STORE_DIR,
            str(DEFAULT_PREPARED_LAYOUT_STORE_DIR),
        )
    )


@lru_cache(maxsize=1)
def get_prepare_job_registry() -> PrepareJobRegistry:
    return PrepareJobRegistry(PreparedLayoutWorker(get_prepared_layout_store()))
