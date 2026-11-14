import pytest

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    compute_prepared_edges,
    prepare_layout_artifacts,
    selected_depths,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.preparation import DATASET_ID, FORMAT_NEWICK
from tests.support.preparation import branching_dataset as _branching_dataset
from tests.support.preparation import varied_chain_dataset as _varied_chain_dataset
from tests.support.preparation import weighted_tree as _dataset


def _boundary_edges(dataset, cluster):
    members = set(cluster.member_node_ids)
    return [
        edge.id
        for edge in dataset.edges
        if (edge.source in members) != (edge.target in members)
    ]


def _multi_tier_dataset() -> Dataset:
    """A long chain exercises several exposed hop-depth cuts."""
    content = "m999"
    for index in range(998, -1, -1):
        content = f"({content}:{(index % 7) + 1})m{index}"
    content = f"{content};"
    normalized = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_ID,
            content=content,
        ).to_domain()
    ).dataset
    return normalized.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": float(int(node.id.removeprefix("m"))),
                        "y": 0.0,
                    }
                )
                for node in normalized.nodes
            ]
        }
    )


def test_prepare_layout_artifacts_builds_pendant_subtrees_with_attachment_nodes() -> (
    None
):
    artifacts = prepare_layout_artifacts(
        _dataset(), lod_options=LodOptions(small_component_threshold=0)
    )

    assert artifacts.dataset.dataset_id == DATASET_ID
    assert artifacts.layout_version
    branch_cluster = next(
        cluster
        for cluster in artifacts.clusters
        if cluster.member_node_ids == ("b", "c", "d", "e")
    )

    assert branch_cluster.representative_node_id == "b"
    assert branch_cluster.member_count == 4
    assert _boundary_edges(artifacts.dataset, branch_cluster) == ["e_a_b_1"]


def test_selected_depths_have_no_level_cap_and_include_full_detail() -> None:
    cuts = selected_depths({str(i): i for i in range(12_001)})
    assert cuts[0] == 0
    assert cuts[-1] == 12_000
    assert len(cuts) > 12
    assert tuple(sorted(set(cuts))) == cuts


def test_prepare_layout_artifacts_partitions_are_nested() -> None:
    dataset = _varied_chain_dataset(120)
    artifacts = prepare_layout_artifacts(dataset)
    levels = sorted({cluster.lod_level for cluster in artifacts.clusters})
    assert len(levels) >= 3
    for level in levels:
        clusters = [
            cluster for cluster in artifacts.clusters if cluster.lod_level == level
        ]
        assert sorted(
            node for cluster in clusters for node in cluster.member_node_ids
        ) == sorted(node.id for node in dataset.nodes)
        assert all(
            cluster.member_count == 1 or len(_boundary_edges(dataset, cluster)) == 1
            for cluster in clusters
        )
        if level:
            previous = [
                cluster
                for cluster in artifacts.clusters
                if cluster.lod_level == level - 1
            ]
            assert all(
                any(
                    set(cluster.member_node_ids) <= set(parent.member_node_ids)
                    for parent in previous
                )
                for cluster in clusters
            )


def test_collapsed_clusters_are_never_intermediate_in_quotient_tree() -> None:
    artifacts = prepare_layout_artifacts(_branching_dataset())
    edges = compute_prepared_edges(artifacts)
    for cluster in artifacts.clusters:
        if cluster.member_count == 1:
            continue
        assert len(_boundary_edges(artifacts.dataset, cluster)) == 1
        incident = [
            edge
            for edge in edges
            if edge.lod_level == cluster.lod_level
            and cluster.representative_node_id in (edge.source, edge.target)
        ]
        assert len(incident) == 1


def test_direct_newick_forest_keeps_component_roots_and_separate_branches() -> None:
    dataset = ingest_dataset(
        NormalizeRequest(format="newick", content="(a:1,b:1)r;(c:1,d:1)s;").to_domain()
    ).dataset
    assert dataset.technical_roots == ("r", "s")
    artifacts = prepare_layout_artifacts(dataset)
    assert all(
        cluster.member_count == 1 or len(_boundary_edges(dataset, cluster)) == 1
        for cluster in artifacts.clusters
    )
    first_component = {"a", "b", "r"}
    assert all(
        (edge.source in first_component) == (edge.target in first_component)
        for edge in compute_prepared_edges(artifacts)
    )


def test_branch_distances_do_not_determine_hop_clusters() -> None:
    dataset = _dataset()
    changed = dataset.model_copy(
        update={
            "edges": [
                edge.model_copy(update={"distance": 100 + index})
                for index, edge in enumerate(dataset.edges)
            ]
        }
    )

    def partitions(tree):
        return {
            (cluster.lod_level, cluster.member_node_ids)
            for cluster in prepare_layout_artifacts(tree).clusters
        }

    assert partitions(dataset) == partitions(changed)


@pytest.mark.parametrize("limit", [8, 32, 64, 128])
def test_small_component_policy_keeps_whole_components_explicit(limit: int) -> None:
    def chain(size, prefix):
        return (
            "(" * (size - 1)
            + prefix
            + str(size - 1)
            + "".join(")" + prefix + str(i) for i in range(size - 2, -1, -1))
            + ";"
        )

    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            content=chain(limit, "a") + chain(limit + 1, "b") + "single;",
        ).to_domain()
    ).dataset
    artifacts = prepare_layout_artifacts(
        dataset, lod_options=LodOptions(small_component_threshold=limit)
    )
    levels = {cluster.lod_level for cluster in artifacts.clusters}
    assert len(levels) > 1
    assert any(cluster.member_count > 1 for cluster in artifacts.clusters)
    for cluster in artifacts.clusters:
        if any(
            node.startswith("a") or node == "single" for node in cluster.member_node_ids
        ):
            assert cluster.member_count == 1
    # Protection changes presentation, never topology or subtree counts.
    indexed = {entry.node_id: entry for entry in artifacts.tree_index}
    assert indexed["a0"].size == limit
    assert indexed[f"a{limit - 1}"].depth == limit - 1


def test_prepared_edges_project_original_edges_to_real_representative_ids() -> None:
    artifacts = prepare_layout_artifacts(_dataset())
    prepared_edges = compute_prepared_edges(artifacts)
    lod_zero_edges = {
        (edge.source, edge.target) for edge in prepared_edges if edge.lod_level == 0
    }

    assert ("a", "b") in lod_zero_edges
    assert all(edge.source != edge.target for edge in prepared_edges)


def test_intermediate_lod_levels_use_precomputed_hop_cuts(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)
    dataset = _multi_tier_dataset()
    result = worker.prepare_dataset(dataset)
    layout_version = result.artifacts.layout_version
    all_node_ids = {node.id for node in dataset.nodes}

    levels = sorted({cluster.lod_level for cluster in result.artifacts.clusters})
    # The fixture must actually have more than the two extreme tiers for this
    # test to mean anything.
    assert len(levels) >= 2

    def read(level: int):
        return store.read_viewport(
            dataset_id=DATASET_ID,
            layout_version=layout_version,
            xmin=None,
            xmax=None,
            ymin=None,
            ymax=None,
            max_nodes=500,
            lod_level=level,
        )

    # The deepest cut resolves to individual ready-node detail:
    # returned nodes stand alone rather than proxying clusters.
    finest = read(levels[-1])
    assert finest.nodes
    assert {node.node_id for node in finest.nodes} <= all_node_ids
    assert not any(node.is_representative for node in finest.nodes)

    # A middle tier (previously collapsed to None by the >=1 short-circuit) now
    # returns cluster representatives instead of falling straight through to
    # individual nodes, and there are strictly fewer of them than nodes.
    middle = read(1)
    assert any(node.is_representative for node in middle.nodes)
    assert len(middle.nodes) < len(all_node_ids)

    # Levels beyond the finest tier clamp to the finest tier (individual nodes)
    # instead of erroring, matching the finest-tier read.
    clamped = read(levels[-1] + 5)
    assert clamped.nodes
    assert not any(node.is_representative for node in clamped.nodes)


def test_prepare_layout_preserves_missing_and_supplied_distances() -> None:
    dataset = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name="missing-distance",
            content="(a:2,b);",
        ).to_domain()
    ).dataset
    artifacts = prepare_layout_artifacts(dataset)
    assert sorted(
        edge.distance for edge in artifacts.dataset.edges if edge.distance is not None
    ) == [2.0]
    assert sum(edge.distance is None for edge in artifacts.dataset.edges) == 1
