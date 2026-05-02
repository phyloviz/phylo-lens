from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from phylo_lens_server.core.models import PreparedDatasetRecord

SLUG_REGEX = re.compile(r"[^a-zA-Z0-9_]+")
SLUG_REPLACEMENT = "_"
SLUG_STRIP_CHARS = "_"
DEFAULT_STORE_DIRNAME = ".phylo_lens_store"


class DatasetStore:
    """Simple file-backed store for prepared datasets and hierarchy indexes."""

    def __init__(self, root_dir: str | Path | None = None) -> None:
        self.root_dir = Path(root_dir or DEFAULT_STORE_DIRNAME)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, PreparedDatasetRecord] = {}
        self.persist_to_disk = _parse_bool_env("PHYLO_LENS_STORE_PERSIST", True)

    def save(self, record: PreparedDatasetRecord) -> None:
        """Persist one prepared dataset record to memory and local disk."""
        self._cache[record.dataset.dataset_id] = record
        if not self.persist_to_disk:
            return

        path = self._path_for_dataset_id(record.dataset.dataset_id)
        # Compact JSON keeps disk writes substantially faster for large datasets.
        path.write_text(record.model_dump_json(), encoding="utf-8")

    def load(self, dataset_id: str) -> PreparedDatasetRecord | None:
        """Load one prepared dataset record from cache or disk if available."""
        cached = self._cache.get(dataset_id)
        if cached is not None:
            return cached

        path = self._path_for_dataset_id(dataset_id)
        if not path.exists():
            return None

        record = PreparedDatasetRecord.model_validate_json(
            path.read_text(encoding="utf-8")
        )
        self._cache[dataset_id] = record
        return record

    def _path_for_dataset_id(self, dataset_id: str) -> Path:
        safe_slug = SLUG_REGEX.sub(SLUG_REPLACEMENT, dataset_id).strip(SLUG_STRIP_CHARS)
        base = safe_slug.lower() or "dataset"
        digest = hashlib.sha256(dataset_id.encode("utf-8")).hexdigest()[:12]
        return self.root_dir / f"{base}_{digest}.json"


def _parse_bool_env(env_name: str, default: bool) -> bool:
    raw_value = os.environ.get(env_name)
    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default
