"""Change orientation and LoD while retaining the authoritative forest and geometry."""

from dataclasses import replace

from phylo_lens_server.domain.dataset import USER_ROOTING_STRATEGY
from phylo_lens_server.domain.preparation import (
    PreparationSummary,
    PreparedLayoutResult,
)
from phylo_lens_server.domain.rooting import (
    RootingResult,
    RootingUpdate,
)
from phylo_lens_server.domain.tree_index import index_forest
from phylo_lens_server.pipeline.layout import compute_prepared_layouts
from phylo_lens_server.pipeline.lod import (
    compute_prepared_edges,
    prepare_layout_artifacts,
    tree_adjacency,
)
from phylo_lens_server.repository.layout_repository import LayoutRepository


def set_technical_root(
    request: RootingUpdate, store: LayoutRepository
) -> RootingResult:
    with store.rooting_revision(request.dataset_id, request.layout_version) as revision:
        source = revision.source
        dataset = source.dataset
        index = index_forest(tree_adjacency(dataset), dataset.technical_roots)
        owners = {entry.node_id: entry.component_id for entry in index}
        roots = dataset.technical_roots
        if request.node_id is None:
            # Map each current component to its original preparation root.
            defaults = {owners[root]: root for root in source.default_roots}
            roots = tuple(defaults[root] for root in roots)
        else:
            if request.node_id not in owners:
                raise ValueError(
                    "The technical root must be an existing canonical tree node."
                )
            component = owners[request.node_id]
            roots = tuple(
                request.node_id if root == component else root for root in roots
            )
        component_ids = dict(zip(dataset.technical_roots, roots, strict=True))
        strategy = (
            source.default_rooting_strategy
            if set(roots) == set(source.default_roots)
            else USER_ROOTING_STRATEGY
        )
        dataset = dataset.model_copy(
            update={
                "technical_roots": roots,
                "source": dataset.source.model_copy(
                    update={"rooting_strategy": strategy}
                ),
            }
        )
        artifacts = prepare_layout_artifacts(
            dataset, sfdp_options=source.sfdp_options, lod_options=source.lod_options
        )
        if roots == source.dataset.technical_roots:
            # Metadata-only revisions have their own version; a no-op keeps it.
            artifacts = replace(artifacts, layout_version=request.layout_version)
        cluster_layouts, positions = compute_prepared_layouts(
            artifacts, positions=revision.positions
        )
        result = PreparedLayoutResult(
            artifacts, cluster_layouts, positions, compute_prepared_edges(artifacts)
        )
        revision.publish(result)
        return RootingResult(
            PreparationSummary.from_result(result, ()),
            component_ids,
            source.default_roots,
        )
