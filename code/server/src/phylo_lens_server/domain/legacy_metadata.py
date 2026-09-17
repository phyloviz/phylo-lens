"""Translate the API v1/persisted flat metadata encoding at compatibility boundaries."""

from math import isfinite
from urllib.parse import quote, unquote

from .ancillary import AncillaryData, AncillarySummary, NodeAnnotations, ProfileSummary

CATEGORY_COUNT_FIELD_PREFIX = "__category_count__"
CATEGORY_COUNT_FIELD_SEPARATOR = "__value__"
PROFILE_COUNT_FIELD = "profile_count"


def is_summary_key(key: str) -> bool:
    return key == PROFILE_COUNT_FIELD or key.startswith(CATEGORY_COUNT_FIELD_PREFIX)


def decode_node_annotations(metadata: AncillaryData) -> NodeAnnotations:
    values: AncillaryData = {}
    counts: dict[str, dict[str, int]] = {}
    isolate_count = None
    for key, value in metadata.items():
        if key == PROFILE_COUNT_FIELD:
            isolate_count = _positive_count(value)
        elif key.startswith(CATEGORY_COUNT_FIELD_PREFIX):
            field, separator, category = key[
                len(CATEGORY_COUNT_FIELD_PREFIX) :
            ].partition(CATEGORY_COUNT_FIELD_SEPARATOR)
            if not separator:
                raise ValueError("Invalid legacy category-count key.")
            counts.setdefault(unquote(field), {})[unquote(category)] = _positive_count(
                value
            )
        else:
            values[key] = value
    return NodeAnnotations(
        ancillary_data={} if counts or isolate_count is not None else values,
        ancillary_summary=AncillarySummary(
            values=values if counts or isolate_count is not None else {},
            category_counts=counts,
        ),
        profile_summary=ProfileSummary(isolate_count=isolate_count),
    )


def encode_node_annotations(annotations: NodeAnnotations) -> AncillaryData:
    metadata = {**annotations.ancillary_summary.values, **annotations.ancillary_data}
    if annotations.profile_summary.isolate_count is not None:
        metadata[PROFILE_COUNT_FIELD] = float(annotations.profile_summary.isolate_count)
    for field, categories in annotations.ancillary_summary.category_counts.items():
        for category, count in categories.items():
            key = f"{CATEGORY_COUNT_FIELD_PREFIX}{quote(field, safe='')}{CATEGORY_COUNT_FIELD_SEPARATOR}{quote(category, safe='')}"
            metadata[key] = float(count)
    return metadata


def _positive_count(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not isfinite(value)
        or value < 1
        or value != int(value)
    ):
        raise ValueError("Summary counts must be positive integers.")
    return int(value)
