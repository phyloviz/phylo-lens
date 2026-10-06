from phylo_lens_server.data.ancillary import build_ancillary_replacement
from phylo_lens_server.domain.revisions import AncillaryUpdate, AncillaryUpdateResult
from phylo_lens_server.repository.interfaces import LayoutRepository


def apply_ancillary_data(
    request: AncillaryUpdate, store: LayoutRepository
) -> AncillaryUpdateResult:
    # Parsing stays inside the source transaction, preserving admission/rollback
    # and the exact immutable source snapshot used to publish the replacement.
    with store.ancillary_revision(
        request.dataset_id, request.layout_version
    ) as revision:
        replacement = build_ancillary_replacement(
            request.ancillary_data,
            revision.source.node_ids,
            revision.source.isolates_by_node_id,
        )
        version = revision.publish(replacement)
    return AncillaryUpdateResult(
        request.dataset_id,
        version,
        replacement.matched_node_count,
        replacement.warnings,
    )
