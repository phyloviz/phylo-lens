from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from tempfile import gettempdir

from phylo_lens_server.prepared_layout.jobs import PrepareJobRegistry
from phylo_lens_server.prepared_layout.store.prepared_layout_store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker

ENV_DATA_DIR = "PHYLO_LENS_DATA_DIR"
ENV_PREPARED_LAYOUT_STORE_DIR = "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR"
DEFAULT_PREPARED_LAYOUT_STORE_DIR = Path(gettempdir()) / "phylo_lens_prepared_layout"
PREPARED_LAYOUT_SUBDIR = "prepared_layout"


def prepared_layout_store_dir() -> Path:
    explicit_store_dir = os.environ.get(ENV_PREPARED_LAYOUT_STORE_DIR)
    if explicit_store_dir:
        return Path(explicit_store_dir)

    data_dir = os.environ.get(ENV_DATA_DIR)
    if data_dir:
        return Path(data_dir) / PREPARED_LAYOUT_SUBDIR

    return DEFAULT_PREPARED_LAYOUT_STORE_DIR


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> PreparedLayoutStore:
    return PreparedLayoutStore(prepared_layout_store_dir())


@lru_cache(maxsize=1)
def get_prepare_job_registry() -> PrepareJobRegistry:
    return PrepareJobRegistry(PreparedLayoutWorker(get_prepared_layout_store()))
