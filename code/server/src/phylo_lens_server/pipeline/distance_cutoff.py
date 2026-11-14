"""Cut complete canonical trees before layout, indexing or LoD aggregation."""

from math import isfinite

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.pipeline.tree_index import index_forest


def cut_dataset(dataset: Dataset, cutoff: float | None) -> Dataset:
    if cutoff is None:
        return dataset
    if isinstance(cutoff, bool) or not isfinite(cutoff) or cutoff < 0:
        raise ValueError("Distance cutoff must be a finite nonnegative number.")
    if any(edge.distance is None for edge in dataset.edges):
        raise ValueError(
            "Distance cutoff requires a distance on every tree edge. "
            "Supply Newick branch lengths; missing distances are not zero."
        )
    neighbors: dict[str, list[tuple[str, str]]] = {
        node.id: [] for node in dataset.nodes
    }
    for edge in dataset.edges:
        neighbors[edge.source].append((edge.target, edge.id))
        neighbors[edge.target].append((edge.source, edge.id))
    # Keep each component's original direction. A severed child becomes a root;
    # no repeated searches or recursion are needed, even on a deep chain.
    index = index_forest(neighbors, dataset.technical_roots)
    kept = tuple(
        edge
        for edge in dataset.edges
        if edge.distance is not None and edge.distance <= cutoff
    )
    retained_pairs = {frozenset((edge.source, edge.target)) for edge in kept}
    roots = tuple(
        entry.node_id
        for entry in index
        if entry.parent_id is None
        or frozenset((entry.node_id, entry.parent_id)) not in retained_pairs
    )
    return dataset.model_copy(
        update={
            "edges": kept,
            "technical_roots": roots,
            "source": dataset.source.model_copy(update={"distance_cutoff": cutoff}),
        }
    )
