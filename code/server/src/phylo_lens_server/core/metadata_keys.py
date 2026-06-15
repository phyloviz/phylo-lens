from __future__ import annotations

from phylo_lens_server.core.models import CanonicalDataset

CATEGORY_COUNT_FIELD_PREFIX = "__category_count__"
PROFILE_COUNT_FIELD = "profile_count"


def is_internal_metadata_key(key: str) -> bool:
    """Return whether a metadata key is generated for implementation use."""
    return key == PROFILE_COUNT_FIELD or key.startswith(CATEGORY_COUNT_FIELD_PREFIX)


def public_metadata_schema_dataset(dataset: CanonicalDataset) -> CanonicalDataset:
    """Hide implementation-only fields from the public metadata schema."""
    return dataset.model_copy(
        update={
            "metadata_schema": [
                field
                for field in dataset.metadata_schema
                if not is_internal_metadata_key(field.key)
            ]
        }
    )
