from __future__ import annotations

import os
from pathlib import Path
from tempfile import gettempdir

ENV_DATA_DIR = "PHYLO_LENS_DATA_DIR"
ENV_PREPARED_LAYOUT_STORE_DIR = "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR"
ENV_MAX_ACTIVE_PREPARE_JOBS = "PHYLO_LENS_MAX_ACTIVE_PREPARE_JOBS"
ENV_PREPARE_JOB_BACKEND = "PHYLO_LENS_PREPARE_JOB_BACKEND"
ENV_POSTGRES_DSN = "PHYLO_LENS_POSTGRES_DSN"

DEFAULT_PREPARED_LAYOUT_STORE_DIR = Path(gettempdir()) / "phylo_lens_prepared_layout"
PREPARED_LAYOUT_SUBDIR = "prepared_layout"
PREPARE_JOB_BACKEND_LOCAL = "local"
PREPARE_JOB_BACKEND_POSTGRES = "postgres"


def prepared_layout_store_dir() -> Path:
    explicit_store_dir = os.environ.get(ENV_PREPARED_LAYOUT_STORE_DIR)
    if explicit_store_dir:
        return Path(explicit_store_dir)

    data_dir = os.environ.get(ENV_DATA_DIR)
    if data_dir:
        return Path(data_dir) / PREPARED_LAYOUT_SUBDIR

    return DEFAULT_PREPARED_LAYOUT_STORE_DIR


def max_active_prepare_jobs() -> int | None:
    raw_value = os.environ.get(ENV_MAX_ACTIVE_PREPARE_JOBS)
    if raw_value is None or raw_value.strip() == "":
        return None
    value = int(raw_value)
    if value < 1:
        raise ValueError(f"{ENV_MAX_ACTIVE_PREPARE_JOBS} must be at least 1.")
    return value


def prepare_job_backend() -> str:
    return os.environ.get(ENV_PREPARE_JOB_BACKEND, PREPARE_JOB_BACKEND_LOCAL).strip()


def postgres_dsn() -> str:
    value = os.environ.get(ENV_POSTGRES_DSN, "").strip()
    if not value:
        raise ValueError(f"{ENV_POSTGRES_DSN} is required when using postgres jobs.")
    return value
