"""Pure summaries of ancillary values and representation state."""

from collections import Counter
from collections.abc import Iterable

from .legacy_metadata import is_summary_key
from .views import LayoutStatus

MetadataValue = str | float | bool | None
MetadataMap = dict[str, MetadataValue]


def aggregate_layout_status(statuses: set[LayoutStatus]) -> LayoutStatus:
    if not statuses:
        return "pending"
    if "failed" in statuses:
        return "failed"
    if "degraded" in statuses:
        return "degraded"
    if statuses == {"ready"}:
        return "ready"
    return "refining"


def aggregate_cluster_metadata(
    member_metadata: list[MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    aggregate: MetadataMap = {}
    for key, field_type in schema:
        value = aggregate_metadata_values(
            field_type,
            (
                metadata[key]
                for metadata in member_metadata
                if metadata.get(key) is not None
            ),
        )
        if value is not None:
            aggregate[key] = value
    return aggregate


def aggregate_render_metadata(
    member_metadata: list[MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    """Aggregate public fields and generated render-only count fields."""
    aggregate = aggregate_cluster_metadata(member_metadata, schema)
    aggregate.update(sum_internal_count_metadata(member_metadata))
    return aggregate


def sum_internal_count_metadata(member_metadata: list[MetadataMap]) -> MetadataMap:
    totals: dict[str, float] = {}
    for metadata in member_metadata:
        for key, value in metadata.items():
            if not is_summary_key(key):
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            totals[key] = totals.get(key, 0.0) + float(value)

    return {
        key: int(value) if value.is_integer() else value
        for key, value in sorted(totals.items())
        if value > 0
    }


def aggregate_metadata_values(
    field_type: str,
    values: Iterable[MetadataValue],
) -> MetadataValue:
    if field_type == "number":
        numeric = [
            value
            for value in values
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        ]
        if not numeric:
            return None
        return sum(numeric) / len(numeric)

    counts = Counter(value for value in values if value is not None)
    if not counts:
        return None
    best_count = max(counts.values())
    return min(
        (value for value, count in counts.items() if count == best_count),
        key=str,
    )


def aggregate_cluster_metadata_by_node_ids(
    member_node_ids: tuple[str, ...],
    metadata_by_node: dict[str, MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    return aggregate_render_metadata(
        [metadata_by_node.get(node_id, {}) for node_id in member_node_ids],
        schema,
    )
