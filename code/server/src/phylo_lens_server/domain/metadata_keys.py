from __future__ import annotations

from phylo_lens_server.domain.models import CanonicalDataset

from .legacy_metadata import (
    CATEGORY_COUNT_FIELD_PREFIX,
    PROFILE_COUNT_FIELD,
    is_summary_key,
)

# Compatibility names for persisted metadata readers.
is_internal_metadata_key = is_summary_key


def public_metadata_schema_dataset(dataset: CanonicalDataset) -> CanonicalDataset:
    """Keep calculated fields outside the public ancillary schema."""
    return dataset.model_copy(update={"summary_schema": []})


__all__ = [
    "CATEGORY_COUNT_FIELD_PREFIX",
    "PROFILE_COUNT_FIELD",
    "is_internal_metadata_key",
    "public_metadata_schema_dataset",
]
