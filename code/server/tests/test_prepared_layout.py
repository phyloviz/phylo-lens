from phylo_lens_server.core.models import CanonicalDataset
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.prepared_layout.ingest import (
    PreparedLayoutIngestError,
    partition_for_threshold,
    prepare_layout_artifacts,
    representative_targets,
)
from phylo_lens_server.prepared_layout.layout import (
    GLOBAL_TARGET_EDGE_LENGTH,
    compute_prepared_layouts,
    parse_graphviz_plain_positions,
)
from phylo_lens_server.prepared_layout.store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import (
    PreparedLayoutWorker,
    compute_prepared_edges,
)

FORMAT_EDGELIST = "edgelist"
DATASET_ID = "prepared-layout-tree"
WEIGHTED_TREE = "source,target,distance\na,b,1\nb,c,1\nc,d,3\nc,e,4\n"


def _dataset() -> CanonicalDataset:
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_ID,
            content=WEIGHTED_TREE,
        )
    )
    positions = {
        "a": (0.0, 0.0),
        "b": (1.0, 0.0),
        "c": (2.0, 0.0),
        "d": (6.0, 0.0),
        "e": (8.0, 0.0),
    }
    return result.dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={"x": positions[node.id][0], "y": positions[node.id][1]}
                )
                for node in result.dataset.nodes
            ]
        }
    )


def _varied_chain_dataset(node_count: int) -> CanonicalDataset:
    content = "source,target,distance\n" + "\n".join(
        f"n{index},n{index + 1},{index + 1}" for index in range(node_count - 1)
    )
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=f"chain-{node_count}",
            content=content,
        )
    )
    return result.dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": float(int(node.id.removeprefix("n"))),
                        "y": 0.0,
                    }
                )
                for node in result.dataset.nodes
            ]
        }
    )


def _branching_dataset() -> CanonicalDataset:
    rows = ["source,target,distance"]
    for branch in range(6):
        previous = "root"
        for depth in range(1, 8):
            node_id = f"b{branch}_{depth}"
            rows.append(f"{previous},{node_id},{depth}")
            previous = node_id
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name="branching-tree",
            content="\n".join(rows),
        )
    )
    return result.dataset


def test_prepare_layout_artifacts_builds_distance_clusters_with_medoids() -> None:
    artifacts = prepare_layout_artifacts(_dataset())

    assert artifacts.dataset.dataset_id == DATASET_ID
    assert artifacts.layout_version
    abc_cluster = next(
        cluster
        for cluster in artifacts.clusters
        if cluster.member_node_ids == ("a", "b", "c")
    )

    assert abc_cluster.representative_node_id == "b"
    assert abc_cluster.member_count == 3
    assert set(abc_cluster.internal_edge_ids) == {"e_a_b_1", "e_b_c_1"}
    assert set(abc_cluster.boundary_edge_ids) == {"e_c_d_1", "e_c_e_1"}


def test_prepare_layout_artifacts_uses_progressive_density_thresholds() -> None:
    dataset = _varied_chain_dataset(1_000)
    artifacts = prepare_layout_artifacts(dataset)
    thresholds = tuple(
        sorted({cluster.threshold for cluster in artifacts.clusters}, reverse=True)
    )
    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    overview_partition = partition_for_threshold(dataset, node_ids, thresholds[0])
    overview_representatives = len(set(overview_partition.values()))

    assert len(thresholds) >= 3
    assert 300 <= representative_targets(12_000, 16)[0] <= 800
    assert 300 <= overview_representatives <= 800


def test_prepare_layout_artifacts_materializes_singletons_at_each_lod() -> None:
    dataset = _varied_chain_dataset(120)
    artifacts = prepare_layout_artifacts(dataset)
    thresholds = tuple(
        sorted({cluster.threshold for cluster in artifacts.clusters}, reverse=True)
    )
    cluster_thresholds_by_member = {
        (cluster.member_node_ids, cluster.threshold) for cluster in artifacts.clusters
    }

    assert len(thresholds) >= 3
    assert any(
        (cluster.member_node_ids, thresholds[0]) in cluster_thresholds_by_member
        for cluster in artifacts.clusters
        if cluster.threshold == thresholds[-1] and cluster.member_count == 1
    )


def test_open_force_tree_layout_spreads_branching_tree_on_both_axes() -> None:
    dataset = _branching_dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, _node_positions = compute_prepared_layouts(artifacts)
    xs = [layout.x for layout in cluster_layouts]
    ys = [layout.y for layout in cluster_layouts]
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)

    assert len(cluster_layouts) > 20
    assert x_span > 0
    assert y_span > 0
    assert min(x_span, y_span) > max(x_span, y_span) * 0.2
    assert max(x_span, y_span) > GLOBAL_TARGET_EDGE_LENGTH * 10


def test_tree_layout_scales_to_large_chains_quickly() -> None:
    dataset = _varied_chain_dataset(1_000)
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions = compute_prepared_layouts(artifacts)

    assert cluster_layouts
    assert node_positions


def test_ghost_layout_uses_global_coordinates_for_clusters_and_members() -> None:
    dataset = _dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions = compute_prepared_layouts(artifacts)
    cluster_by_id = {cluster.cluster_id: cluster for cluster in artifacts.clusters}
    position_by_cluster_and_node = {
        (position.cluster_id, position.node_id): position for position in node_positions
    }

    for layout in cluster_layouts:
        representative_node_id = cluster_by_id[layout.cluster_id].representative_node_id
        representative_position = position_by_cluster_and_node[
            (layout.cluster_id, representative_node_id)
        ]
        assert (layout.x, layout.y) == (
            representative_position.x,
            representative_position.y,
        )


def test_prepared_edges_project_original_edges_to_real_representative_ids() -> None:
    artifacts = prepare_layout_artifacts(_dataset())
    prepared_edges = compute_prepared_edges(artifacts)
    lod_zero_edges = {
        (edge.source, edge.target) for edge in prepared_edges if edge.lod_level == 0
    }

    assert ("b", "d") in lod_zero_edges
    assert ("b", "e") in lod_zero_edges
    assert all(edge.source != edge.target for edge in prepared_edges)


def test_graphviz_plain_parser_handles_quoted_node_ids() -> None:
    positions = parse_graphviz_plain_positions(
        "graph 1 3 1\n"
        'node "a b" 0.5 1.25 0.1 0.1 "" solid ellipse black lightgrey\n'
        'node "c-d" 2.0 3.5 0.1 0.1 "" solid ellipse black lightgrey\n'
        "stop\n"
    )

    assert positions == {"a b": (0.5, 1.25), "c-d": (2.0, 3.5)}


def test_prepared_layout_worker_persists_ready_cluster_and_node_positions(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)

    result = worker.prepare_dataset(_dataset())

    cluster_layouts = store.load_cluster_layouts(
        DATASET_ID,
        result.artifacts.layout_version,
    )
    node_positions = store.load_node_positions(
        DATASET_ID,
        result.artifacts.layout_version,
    )

    assert cluster_layouts
    assert node_positions
    assert all(layout.status == "ready" for layout in cluster_layouts)
    assert all(position.status == "ready" for position in node_positions)
    assert result.prepared_edges
    assert {position.node_id for position in node_positions} >= {
        "a",
        "b",
        "c",
        "d",
        "e",
    }
    assert all(position.cluster_id for position in node_positions)


def test_prepared_layout_worker_clears_previous_dataset_positions(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)

    first_dataset = _varied_chain_dataset(30).model_copy(
        update={"dataset_id": "replace-tree"}
    )
    second_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "replace-tree"}
    )
    first = worker.prepare_dataset(first_dataset)
    second = worker.prepare_dataset(second_dataset)

    assert not store.load_node_positions(
        first.artifacts.dataset.dataset_id,
        first.artifacts.layout_version,
    )
    current_positions = store.load_node_positions(
        second.artifacts.dataset.dataset_id,
        second.artifacts.layout_version,
    )
    assert {position.node_id for position in current_positions} == {
        f"n{index}" for index in range(5)
    }


def test_prepared_layout_worker_can_run_on_background_thread(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)

    try:
        future = worker.submit_prepare_dataset(_dataset())
        result = future.result(timeout=10)
    finally:
        worker.shutdown()

    assert result.artifacts.dataset.dataset_id == DATASET_ID
    assert store.load_node_positions(DATASET_ID, result.artifacts.layout_version)


def test_prepare_layout_rejects_missing_distances() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name="missing-distance",
            content="source,target\na,b\n",
        )
    ).dataset

    try:
        prepare_layout_artifacts(dataset)
    except PreparedLayoutIngestError as error:
        assert "distance" in str(error).lower()
    else:
        raise AssertionError("Expected PreparedLayoutIngestError")
