from __future__ import annotations

import hashlib
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

    def save(self, record: PreparedDatasetRecord) -> None:
        """Persist one prepared dataset record to memory and local disk."""
        path = self._path_for_dataset_id(record.dataset.dataset_id)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
        self._cache[record.dataset.dataset_id] = record

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
        safe_slug = SLUG_REGEX.sub(SLUG_REPLACEMENT, dataset_id).strip(
            SLUG_STRIP_CHARS
        )
        base = safe_slug.lower() or "dataset"
        digest = hashlib.sha256(dataset_id.encode("utf-8")).hexdigest()[:12]
        return self.root_dir / f"{base}_{digest}.json"
