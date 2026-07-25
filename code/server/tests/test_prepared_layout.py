import multiprocessing
import shutil
import subprocess
from concurrent.futures import Future

import pytest

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.domain.models import (
    CanonicalDataset,
    CanonicalEdge,
    MetadataField,
    MetadataType,
)
from phylo_lens_server.pipeline.ingest import (
    PreparedLayoutIngestError,
    layout_version_for_dataset,
    partition_for_threshold,
    prepare_layout_artifacts,
    representative_targets,
)
from phylo_lens_server.pipeline.layout import (
    GLOBAL_TARGET_EDGE_LENGTH,
    GRAPHVIZ_SFDP_COMMAND,
    LAYOUT_DEGRADED_SFDP_MISSING,
    GraphvizLayoutTimeoutError,
    compute_prepared_layouts,
    graphviz_dot_payload,
    graphviz_sfdp_positions,
    has_multiple_components,
    normalize_global_positions,
    parse_graphviz_plain_positions,
)
from phylo_lens_server.pipeline.models import PreparedLayoutResult
from phylo_lens_server.pipeline.worker import (
    PreparedLayoutWorker,
    compute_prepared_edges,
)
from phylo_lens_server.repository.jobs.local import (
    PrepareJobRegistry,
    PrepareQueueFullError,
)
from phylo_lens_server.repository.jobs.result_payload import prepare_result_payload
from phylo_lens_server.repository.layout.metadata_reader import (
    aggregate_cluster_metadata,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.services import graph_service

SFDP_AVAILABLE = shutil.which(GRAPHVIZ_SFDP_COMMAND) is not None
EXPECTED_LAYOUT_STATUS = "ready" if SFDP_AVAILABLE else "degraded"

FORMAT_NEWICK = "newick"
DATASET_ID = "prepared-layout-tree"
WEIGHTED_TREE = "(((d:3,e:4)c:1)b:1)a;"


def _dataset() -> CanonicalDataset:
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
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
    content = f"n{node_count - 1}"
    for index in range(node_count - 2, -1, -1):
        content = f"({content}:{index + 1})n{index}"
    content = f"{content};"
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
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
    branches = []
    for branch in range(6):
        chain = f"b{branch}_7"
        for depth in range(6, 0, -1):
            chain = f"({chain}:{depth + 1})b{branch}_{depth}"
        branches.append(f"{chain}:1")
    content = f"({','.join(branches)})root;"
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name="branching-tree",
            content=content,
        )
    )
    return result.dataset


def test_prepare_layout_artifacts_builds_distance_clusters_with_representatives() -> (
    None
):
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


def test_has_multiple_components_distinguishes_tree_from_forest() -> None:
    node_ids = ("a", "b", "c")
    connected = (
        CanonicalEdge(id="e1", source="a", target="b", distance=1.0),
        CanonicalEdge(id="e2", source="b", target="c", distance=1.0),
    )
    forest = (CanonicalEdge(id="e1", source="a", target="b", distance=1.0),)

    assert has_multiple_components(node_ids, connected) is False
    # 'c' is an isolated singleton, mirroring a goeBURST forest export.
    assert has_multiple_components(node_ids, forest) is True


def test_dot_payload_packs_only_when_graph_is_disconnected() -> None:
    """A forest lays each component out independently; a tree keeps overlap=scale.

    ``overlap=scale`` runs global overlap removal that is pathological for a graph
    with many disconnected components, so the payload must switch to a packed
    per-component layout there while leaving the connected case unchanged.
    """
    node_ids = ("a", "b", "c")
    connected = (
        CanonicalEdge(id="e1", source="a", target="b", distance=1.0),
        CanonicalEdge(id="e2", source="b", target="c", distance=1.0),
    )
    forest = (CanonicalEdge(id="e1", source="a", target="b", distance=1.0),)

    connected_payload = graphviz_dot_payload(node_ids, connected)
    forest_payload = graphviz_dot_payload(node_ids, forest)

    assert "overlap=scale" in connected_payload
    assert "pack=true" not in connected_payload
    assert "overlap=prism" in forest_payload
    assert "pack=true" in forest_payload
    assert "packmode=array" in forest_payload


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


def test_representative_targets_progressively_increase_for_large_trees() -> None:
    targets = representative_targets(12_000, 16)

    assert len(targets) >= 5
    assert targets[0] < targets[1] < targets[2] < targets[-1]
    assert targets[-1] == 12_000
    assert all(target <= 12_000 for target in targets)


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


@pytest.mark.skipif(
    not SFDP_AVAILABLE,
    reason=(
        "Force-directed spread requires the Graphviz 'sfdp' binary; without it "
        "the layout falls back to a circular arrangement that cannot satisfy the "
        "spread assertions."
    ),
)
def test_open_force_tree_layout_spreads_branching_tree_on_both_axes() -> None:
    dataset = _branching_dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, _node_positions, _reason = compute_prepared_layouts(artifacts)
    xs = [layout.x for layout in cluster_layouts]
    ys = [layout.y for layout in cluster_layouts]
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)

    assert len(cluster_layouts) > 20
    assert x_span > 0
    assert y_span > 0
    assert min(x_span, y_span) > max(x_span, y_span) * 0.2
    assert max(x_span, y_span) > GLOBAL_TARGET_EDGE_LENGTH * 10


def test_normalized_graphviz_positions_repair_single_axis_collapse() -> None:
    positions = {
        "a": (0.0, 0.0),
        "b": (0.0, 1.0),
        "c": (0.0, 2.0),
        "d": (0.0, 3.0),
    }

    normalized = normalize_global_positions(
        positions,
        [(0, 1), (1, 2), (2, 3)],
        GLOBAL_TARGET_EDGE_LENGTH,
    )
    xs = [position[0] for position in normalized.values()]
    ys = [position[1] for position in normalized.values()]
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)

    assert x_span > 0.0
    assert y_span > 0.0
    assert min(x_span, y_span) > max(x_span, y_span) * 0.2


def test_normalized_graphviz_positions_repair_point_collapse() -> None:
    positions = {
        "a": (0.0, 0.0),
        "b": (0.0, 0.0),
        "c": (0.0, 0.0),
        "d": (0.0, 0.0),
    }

    normalized = normalize_global_positions(
        positions,
        [(0, 1), (1, 2), (2, 3)],
        GLOBAL_TARGET_EDGE_LENGTH,
    )
    xs = [position[0] for position in normalized.values()]
    ys = [position[1] for position in normalized.values()]

    assert max(xs) - min(xs) > 0.0
    assert max(ys) - min(ys) > 0.0


def test_layout_reports_degraded_status_when_sfdp_is_missing(monkeypatch) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: None,
    )

    artifacts = prepare_layout_artifacts(_dataset())
    cluster_layouts, node_positions, reason = compute_prepared_layouts(artifacts)

    assert cluster_layouts
    assert node_positions
    assert all(layout.status == "degraded" for layout in cluster_layouts)
    assert all(position.status == "degraded" for position in node_positions)
    assert reason == LAYOUT_DEGRADED_SFDP_MISSING


def test_tree_layout_scales_to_large_chains_quickly() -> None:
    dataset = _varied_chain_dataset(1_000)
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions, _reason = compute_prepared_layouts(artifacts)

    assert cluster_layouts
    assert node_positions


def test_ghost_layout_uses_global_coordinates_for_clusters_and_members() -> None:
    dataset = _dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions, _reason = compute_prepared_layouts(artifacts)
    cluster_by_id = {cluster.cluster_id: cluster for cluster in artifacts.clusters}
    position_by_node = {position.node_id: position for position in node_positions}

    assert len(node_positions) == len(position_by_node)

    for layout in cluster_layouts:
        representative_node_id = cluster_by_id[layout.cluster_id].representative_node_id
        representative_position = position_by_node[representative_node_id]
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


def _multi_tier_dataset() -> CanonicalDataset:
    """A chain large enough that adaptive threshold selection yields several
    distinct LoD tiers (unlike the tiny _dataset fixture, which collapses to
    one). The 1000-node varied-distance chain produces three tiers."""
    content = "m999"
    for index in range(998, -1, -1):
        content = f"({content}:{(index % 7) + 1})m{index}"
    content = f"{content};"
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_ID,
            content=content,
        )
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


def test_intermediate_lod_levels_index_into_precomputed_thresholds(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    dataset = _multi_tier_dataset()
    result = worker.prepare_dataset(dataset)
    layout_version = result.artifacts.layout_version
    all_node_ids = {node.id for node in dataset.nodes}

    # Distinct thresholds, coarsest first, mirror the lod_level indexing used by
    # _threshold_for_lod_level and compute_prepared_edges.
    thresholds_desc = sorted(
        {
            cluster.threshold
            for cluster in result.artifacts.clusters
            if cluster.threshold is not None
        },
        reverse=True,
    )
    # The fixture must actually have more than the two extreme tiers for this
    # test to mean anything.
    assert len(thresholds_desc) >= 2

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

    # The finest tier (min threshold) resolves to individual ready-node detail:
    # returned nodes stand alone rather than proxying clusters.
    finest = read(len(thresholds_desc) - 1)
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
    clamped = read(len(thresholds_desc) + 5)
    assert clamped.nodes
    assert not any(node.is_representative for node in clamped.nodes)


def test_graphviz_plain_parser_handles_quoted_node_ids() -> None:
    positions = parse_graphviz_plain_positions(
        "graph 1 3 1\n"
        'node "a b" 0.5 1.25 0.1 0.1 "" solid ellipse black lightgrey\n'
        'node "c-d" 2.0 3.5 0.1 0.1 "" solid ellipse black lightgrey\n'
        "stop\n"
    )

    assert positions == {"a b": (0.5, 1.25), "c-d": (2.0, 3.5)}


def test_graphviz_sfdp_positions_applies_configured_timeout(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class Completed:
        stdout = (
            "graph 1 3 1\n"
            'node "a" 0 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            'node "b" 1 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            "stop\n"
        )

    def fake_run(*args, **kwargs):
        calls.append(kwargs)
        return Completed()

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run",
        fake_run,
    )
    monkeypatch.setenv("PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS", "8.5")

    positions, reason = graphviz_sfdp_positions(
        ("a", "b"),
        (CanonicalEdge(id="e1", source="a", target="b", distance=1.0),),
    )

    assert reason is None
    assert positions == {"a": (0.0, 0.0), "b": (1.0, 0.0)}
    assert calls[0]["timeout"] == 8.5


def test_graphviz_sfdp_positions_timeout_fails_layout_job(monkeypatch) -> None:
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(cmd=command, timeout=kwargs["timeout"])

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run",
        fake_run,
    )
    monkeypatch.setenv("PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS", "1")

    with pytest.raises(GraphvizLayoutTimeoutError):
        graphviz_sfdp_positions(
            ("a", "b"),
            (CanonicalEdge(id="e1", source="a", target="b", distance=1.0),),
        )


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
    assert all(layout.status == EXPECTED_LAYOUT_STATUS for layout in cluster_layouts)
    assert all(position.status == EXPECTED_LAYOUT_STATUS for position in node_positions)
    assert len(node_positions) == len({position.node_id for position in node_positions})
    assert result.prepared_edges
    assert {position.node_id for position in node_positions} >= {
        "a",
        "b",
        "c",
        "d",
        "e",
    }
    assert all(position.cluster_id for position in node_positions)


def test_prepared_layout_worker_keeps_previous_ready_version_until_replaced(
    tmp_path,
) -> None:
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

    assert (
        store.latest_layout_version("replace-tree") == second.artifacts.layout_version
    )
    previous_positions = store.load_node_positions(
        first.artifacts.dataset.dataset_id,
        first.artifacts.layout_version,
    )
    assert {position.node_id for position in previous_positions} == {
        f"n{index}" for index in range(30)
    }
    current_positions = store.load_node_positions(
        second.artifacts.dataset.dataset_id,
        second.artifacts.layout_version,
    )
    assert {position.node_id for position in current_positions} == {
        f"n{index}" for index in range(5)
    }


def test_latest_layout_version_ignores_refining_layouts(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    ready_artifacts = prepare_layout_artifacts(
        _varied_chain_dataset(5).model_copy(update={"dataset_id": "publish-tree"})
    )
    refining_artifacts = prepare_layout_artifacts(
        _varied_chain_dataset(8).model_copy(update={"dataset_id": "publish-tree"})
    )

    store.save_artifacts(ready_artifacts, status="refining")
    assert store.latest_layout_version("publish-tree") is None

    store.publish_layout_version(
        dataset_id=ready_artifacts.dataset.dataset_id,
        layout_version=ready_artifacts.layout_version,
        status="ready",
    )
    assert store.latest_layout_version("publish-tree") == ready_artifacts.layout_version

    store.save_artifacts(refining_artifacts, status="refining")
    assert store.latest_layout_version("publish-tree") == ready_artifacts.layout_version

    store.publish_layout_version(
        dataset_id=refining_artifacts.dataset.dataset_id,
        layout_version=refining_artifacts.layout_version,
        status="degraded",
    )
    assert (
        store.latest_layout_version("publish-tree") == refining_artifacts.layout_version
    )


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


class RecordingPrepareWorker:
    def __init__(self) -> None:
        self.submitted_datasets: list[CanonicalDataset] = []
        self.futures: list[Future[PreparedLayoutResult]] = []

    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        self.submitted_datasets.append(dataset)
        self.futures.append(future)
        return future

    def shutdown(self) -> None:
        pass


def _prepared_result(dataset: CanonicalDataset) -> PreparedLayoutResult:
    return PreparedLayoutResult(artifacts=prepare_layout_artifacts(dataset))


class ImmediatelyCompletedPrepareWorker:
    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        future.set_result(_prepared_result(dataset))
        return future

    def shutdown(self) -> None:
        pass


class ImmediatelyFailedPrepareWorker:
    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        future.set_exception(RuntimeError("layout failed immediately"))
        return future

    def shutdown(self) -> None:
        pass


def _run_immediate_future_registry_case(kind: str, queue) -> None:
    dataset = _dataset().model_copy(update={"dataset_id": f"immediate-{kind}"})
    worker = (
        ImmediatelyCompletedPrepareWorker()
        if kind == "ready"
        else ImmediatelyFailedPrepareWorker()
    )
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with registry.reserve_capacity():
        job_id = registry.submit(
            dataset,
            ("submitted warning",),
            reserved_capacity=True,
        )
        active_inside_reservation = registry._active_reservations
        snapshot_inside_reservation = registry.snapshot(job_id)

    snapshot_after_reservation = registry.snapshot(job_id)
    queue.put(
        {
            "active_inside_reservation": active_inside_reservation,
            "active_after_reservation": registry._active_reservations,
            "job_id": job_id,
            "status_inside_reservation": (
                None
                if snapshot_inside_reservation is None
                else snapshot_inside_reservation.status
            ),
            "status_after_reservation": (
                None
                if snapshot_after_reservation is None
                else snapshot_after_reservation.status
            ),
            "result_retained": (
                None
                if snapshot_after_reservation is None
                else snapshot_after_reservation.result is not None
            ),
            "result_payload": (
                None
                if snapshot_after_reservation is None
                else snapshot_after_reservation.result_payload
            ),
            "error": (
                None
                if snapshot_after_reservation is None
                else snapshot_after_reservation.error
            ),
        }
    )


def _immediate_future_registry_case(kind: str) -> dict:
    context = multiprocessing.get_context("fork")
    queue = context.Queue()
    process = context.Process(
        target=_run_immediate_future_registry_case,
        args=(kind, queue),
    )
    process.start()
    process.join(3)
    if process.is_alive():
        process.terminate()
        process.join(1)
        pytest.fail("PrepareJobRegistry.submit() deadlocked for completed Future.")
    assert process.exitcode == 0
    assert not queue.empty()
    return queue.get_nowait()


def test_prepare_job_registry_coalesces_duplicate_in_flight_layouts() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)

    first_job_id = registry.submit(_dataset())
    second_job_id = registry.submit(_dataset())

    assert second_job_id == first_job_id
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_accepts_already_completed_future() -> None:
    result = _immediate_future_registry_case("ready")

    assert result["job_id"]
    assert result["active_inside_reservation"] == 1
    assert result["active_after_reservation"] == 0
    assert result["status_inside_reservation"] == "ready"
    assert result["status_after_reservation"] == "ready"
    assert result["result_retained"] is False
    assert result["result_payload"] is not None
    assert result["result_payload"]["dataset_id"] == "immediate-ready"
    assert "submitted warning" in result["result_payload"]["warnings"]


def test_prepare_job_registry_accepts_already_failed_future() -> None:
    result = _immediate_future_registry_case("failed")

    assert result["job_id"]
    assert result["active_inside_reservation"] == 1
    assert result["active_after_reservation"] == 0
    assert result["status_inside_reservation"] == "failed"
    assert result["status_after_reservation"] == "failed"
    assert result["result_retained"] is False
    assert result["result_payload"] is None
    assert "layout failed immediately" in result["error"]


def test_prepare_job_registry_reuses_completed_successful_layout_jobs() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    first_job_id = registry.submit(dataset)
    worker.futures[0].set_result(_prepared_result(dataset))
    second_job_id = registry.submit(dataset)

    assert second_job_id == first_job_id
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_drops_completed_future_result_after_payload_capture() -> (
    None
):
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    job_id = registry.submit(dataset, ("submitted warning",))
    worker.futures[0].set_result(_prepared_result(dataset))
    snapshot = registry.snapshot(job_id)
    duplicate_job_id = registry.submit(dataset)

    assert duplicate_job_id == job_id
    assert snapshot is not None
    assert snapshot.status == "ready"
    assert snapshot.result is None
    assert snapshot.result_payload == prepare_result_payload(
        _prepared_result(dataset),
        ("submitted warning",),
    )
    assert job_id not in registry._futures


def test_prepare_job_registry_retries_failed_layout_jobs() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    first_job_id = registry.submit(dataset)
    worker.futures[0].set_exception(RuntimeError("layout failed"))
    second_job_id = registry.submit(dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


def test_prepare_job_registry_does_not_coalesce_changed_dataset_content() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "same-name"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "same-name"}
    )

    first_job_id = registry.submit(first_dataset)
    second_job_id = registry.submit(second_dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


def test_layout_version_changes_when_metadata_value_changes() -> None:
    dataset = _dataset()
    portugal = dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="country", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {"a": {"country": "PT"}},
        }
    )
    spain = dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="country", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {"a": {"country": "ES"}},
        }
    )

    assert layout_version_for_dataset(portugal) != layout_version_for_dataset(spain)


def test_layout_version_changes_when_metadata_field_is_added_or_removed() -> None:
    dataset = _dataset().model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="country", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {"a": {"country": "PT"}},
        }
    )
    with_added_field = dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="country", type=MetadataType.STRING),
                MetadataField(key="source", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {"a": {"country": "PT", "source": "blood"}},
        }
    )

    assert layout_version_for_dataset(dataset) != layout_version_for_dataset(
        with_added_field
    )


def test_layout_version_is_stable_for_same_metadata_with_different_dict_order() -> None:
    dataset = _dataset()
    first = dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="source", type=MetadataType.STRING),
                MetadataField(key="country", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {
                "a": {"country": "PT", "source": "blood"},
                "b": {"source": "csf", "country": "ES"},
            },
        }
    )
    second = dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="country", type=MetadataType.STRING),
                MetadataField(key="source", type=MetadataType.STRING),
            ],
            "metadata_by_node_id": {
                "b": {"country": "ES", "source": "csf"},
                "a": {"source": "blood", "country": "PT"},
            },
        }
    )

    assert layout_version_for_dataset(first) == layout_version_for_dataset(second)


def test_layout_version_reuses_independently_normalized_identical_requests() -> None:
    request = NormalizeRequest(
        format=FORMAT_NEWICK,
        dataset_name="reuse-tree",
        content=WEIGHTED_TREE,
        metadata_schema=[{"key": "country", "type": "string"}],
        metadata_by_node_id={"a": {"country": "PT"}},
    )

    first = normalize_dataset(request).dataset
    second = normalize_dataset(request).dataset

    assert first.source.generated_at != second.source.generated_at
    assert layout_version_for_dataset(first) == layout_version_for_dataset(second)


def test_prepare_job_registry_rejects_new_work_at_active_limit() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(
        worker,
        max_active_jobs=1,
    )
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "limited"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "limited"}
    )

    first_job_id = registry.submit(first_dataset)
    duplicate_job_id = registry.submit(first_dataset)

    assert duplicate_job_id == first_job_id
    with pytest.raises(PrepareQueueFullError):
        registry.submit(second_dataset)
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_reserves_capacity_before_dataset_submission() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with registry.reserve_capacity():
        with pytest.raises(PrepareQueueFullError), registry.reserve_capacity():
            pass
        job_id = registry.submit(_dataset(), reserved_capacity=True)

    assert registry.snapshot(job_id).status == "pending"
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_releases_capacity_reservation_on_failure() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with pytest.raises(RuntimeError), registry.reserve_capacity():
        raise RuntimeError("normalization failed")

    with registry.reserve_capacity():
        pass


def test_prepare_graph_job_reserves_capacity_before_normalization(monkeypatch) -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)
    normalized = False

    def fake_normalize(*args, **kwargs):
        nonlocal normalized
        normalized = True
        raise AssertionError("normalization should not run when capacity is full")

    monkeypatch.setattr(graph_service, "normalize_dataset", fake_normalize)

    with registry.reserve_capacity(), pytest.raises(PrepareQueueFullError):
        graph_service.prepare_graph_job(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name="reserved",
                content=WEIGHTED_TREE,
            ),
            registry,
        )

    assert normalized is False


def test_prepare_job_registry_allows_new_work_after_active_job_completes() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(
        worker,
        max_active_jobs=1,
    )
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "limited"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "limited"}
    )

    first_job_id = registry.submit(first_dataset)
    worker.futures[0].set_result(_prepared_result(first_dataset))
    second_job_id = registry.submit(second_dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


INTERNAL_COUNT_KEY = "__category_count__region__value__north"


def _dataset_with_metadata() -> CanonicalDataset:
    dataset = _dataset()
    metadata_by_node_id = {
        "a": {"region": "north", "score": 10, "flag": True, INTERNAL_COUNT_KEY: 2},
        "b": {"region": "north", "score": 20, "flag": True, INTERNAL_COUNT_KEY: 2},
        "c": {"region": "south", "score": 30, "flag": False, INTERNAL_COUNT_KEY: 2},
        "d": {"region": "south", "score": 5, "flag": False, INTERNAL_COUNT_KEY: 2},
        "e": {"region": "east", "score": 15, "flag": True, INTERNAL_COUNT_KEY: 2},
    }
    return dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="region", type=MetadataType.STRING),
                MetadataField(key="score", type=MetadataType.NUMBER),
                MetadataField(key="flag", type=MetadataType.BOOLEAN),
                MetadataField(key=INTERNAL_COUNT_KEY, type=MetadataType.NUMBER),
            ],
            "metadata_by_node_id": metadata_by_node_id,
        }
    )


def test_aggregate_cluster_metadata_uses_mode_for_categorical_and_mean_for_numeric() -> (
    None
):
    member_metadata = [
        {"region": "north", "score": 10, "flag": True},
        {"region": "north", "score": 20, "flag": True},
        {"region": "south", "score": 30, "flag": False, "missing": None},
    ]
    schema = (("region", "string"), ("score", "number"), ("flag", "boolean"))

    aggregate = aggregate_cluster_metadata(member_metadata, schema)

    assert aggregate["region"] == "north"
    assert aggregate["score"] == 20.0
    assert aggregate["flag"] is True


def test_aggregate_cluster_metadata_skips_null_only_and_breaks_ties_alphabetically() -> (
    None
):
    member_metadata = [
        {"region": "zulu", "empty": None},
        {"region": "alpha", "empty": None},
    ]
    schema = (("region", "string"), ("empty", "string"))

    aggregate = aggregate_cluster_metadata(member_metadata, schema)

    assert aggregate["region"] == "alpha"
    assert "empty" not in aggregate


def test_viewport_cluster_members_carry_public_node_metadata(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    abc_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("a", "b", "c")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        cluster_id=abc_cluster.cluster_id,
    )
    metadata_by_id = {node.node_id: node.metadata for node in read.nodes}

    assert metadata_by_id["a"] == {
        "region": "north",
        "score": 10,
        "flag": True,
        INTERNAL_COUNT_KEY: 2,
    }
    assert metadata_by_id["c"] == {
        "region": "south",
        "score": 30,
        "flag": False,
        INTERNAL_COUNT_KEY: 2,
    }
    assert metadata_by_id["b"][INTERNAL_COUNT_KEY] == 2
    schema_keys = {field.key for field in read.metadata_schema}
    assert schema_keys == {"region", "score", "flag"}


def test_viewport_cluster_members_prioritize_focused_node_when_limited(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    abc_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("a", "b", "c")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=1,
        cluster_id=abc_cluster.cluster_id,
        focus_node_id="c",
    )

    assert [node.node_id for node in read.nodes if not node.is_representative] == ["c"]


def test_search_nodes_matches_node_id_and_metadata_across_whole_tree(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    version = result.artifacts.layout_version

    # A node-id hit outranks a metadata-value hit and is found regardless of any
    # viewport bounds (this is a whole-tree scan, not a slice read).
    by_id = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="a", limit=25
    )
    ids = [match.node_id for match in by_id.matches]
    assert "a" in ids
    exact = next(match for match in by_id.matches if match.node_id == "a")
    assert exact.score == 100  # SEARCH_SCORE_ID_EXACT

    # Metadata values are searchable; "north" belongs to a and b.
    by_meta = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="north", limit=25
    )
    meta_ids = {match.node_id for match in by_meta.matches}
    assert {"a", "b"} <= meta_ids
    assert all(match.score == 20 for match in by_meta.matches)  # METADATA_VALUE


def test_search_nodes_excludes_internal_keys_and_respects_limit(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    version = result.artifacts.layout_version

    # The internal __category_count__ value (2) must never surface as a match.
    internal = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="2", limit=25
    )
    assert all(match.score != 20 for match in internal.matches) or not any(
        "region" in match.matched_text for match in internal.matches
    )

    # An empty query yields nothing; the limit truncates but total_count is full.
    blank = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="   ", limit=25
    )
    assert blank.matches == () and blank.total_count == 0

    capped = store.search_nodes(
        dataset_id=DATASET_ID, layout_version=version, query="south", limit=1
    )
    assert len(capped.matches) == 1
    assert capped.total_count >= 2


def test_viewport_expansion_reroutes_boundary_edges_to_neighbor_representatives(
    tmp_path,
) -> None:
    # At threshold 1.0 the tree splits into cluster (a, b, c) plus singleton
    # clusters {d} and {e}. Expanding (a, b, c) exposes members a/b/c and their
    # internal edges, and reroutes the two boundary edges c-d and c-e to the
    # neighbor representatives d and e as meta-edges.
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset())
    abc_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("a", "b", "c")
    )

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        cluster_id=abc_cluster.cluster_id,
    )

    node_ids = {node.node_id for node in read.nodes}
    # Members plus the two surfaced neighbor representatives.
    assert node_ids == {"a", "b", "c", "d", "e"}
    reps = {node.node_id for node in read.nodes if node.is_representative}
    assert reps == {"d", "e"}

    # Every emitted edge references a returned node (visibility invariant).
    for edge in read.edges:
        assert edge.source in node_ids
        assert edge.target in node_ids

    meta_edges = {
        (edge.source, edge.target): edge for edge in read.edges if edge.is_meta
    }
    assert set(meta_edges) == {("c", "d"), ("c", "e")}
    assert meta_edges[("c", "d")].distance == 3.0
    assert meta_edges[("c", "e")].distance == 4.0
    assert all(edge.bundled_edge_count == 1 for edge in meta_edges.values())

    # Ordinary internal edges stay non-meta.
    internal_edges = [edge for edge in read.edges if not edge.is_meta]
    assert {edge.edge_id for edge in internal_edges} == {"e_a_b_1", "e_b_c_1"}
    assert all(edge.bundled_edge_count is None for edge in internal_edges)


def _chain_dataset_with_metadata(node_count: int) -> CanonicalDataset:
    dataset = _varied_chain_dataset(node_count).model_copy(
        update={"dataset_id": DATASET_ID}
    )
    regions = ("north", "south", "east")
    metadata_by_node_id = {
        f"n{index}": {
            "region": regions[index % len(regions)],
            "score": index,
            "flag": index % 2 == 0,
            INTERNAL_COUNT_KEY: 1,
        }
        for index in range(node_count)
    }
    return dataset.model_copy(
        update={
            "metadata_schema": [
                MetadataField(key="region", type=MetadataType.STRING),
                MetadataField(key="score", type=MetadataType.NUMBER),
                MetadataField(key="flag", type=MetadataType.BOOLEAN),
                MetadataField(key=INTERNAL_COUNT_KEY, type=MetadataType.NUMBER),
            ],
            "metadata_by_node_id": metadata_by_node_id,
        }
    )


def test_viewport_representatives_carry_cluster_metadata_aggregate(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    dataset = _chain_dataset_with_metadata(60)
    result = worker.prepare_dataset(dataset)
    members_by_cluster = {
        cluster.cluster_id: cluster.member_node_ids
        for cluster in result.artifacts.clusters
    }
    public_metadata = {
        node_id: {
            key: value for key, value in metadata.items() if key != INTERNAL_COUNT_KEY
        }
        for node_id, metadata in dataset.metadata_by_node_id.items()
    }
    public_schema = (("region", "string"), ("score", "number"), ("flag", "boolean"))

    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=500,
        lod_level=0,
    )
    representatives = [node for node in read.nodes if node.is_representative]

    assert representatives
    for node in representatives:
        expected = aggregate_cluster_metadata(
            [public_metadata[nid] for nid in members_by_cluster[node.cluster_id]],
            public_schema,
        )
        expected[INTERNAL_COUNT_KEY] = len(members_by_cluster[node.cluster_id])
        assert node.metadata == expected


def test_detail_viewport_keeps_boundary_edges_and_offscreen_neighbors(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    # Discover the computed positions via an unbounded detail read.
    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    assert set(positions) == {"a", "b", "c", "d", "e"}
    assert {edge.edge_id for edge in full.edges} == {
        "e_a_b_1",
        "e_b_c_1",
        "e_c_d_1",
        "e_c_e_1",
    }

    # A tight box around only "c" — its three edges (to b, d, e) all straddle
    # the viewport boundary.
    cx, cy = positions["c"]
    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=cx - 1e-6,
        xmax=cx + 1e-6,
        ymin=cy - 1e-6,
        ymax=cy + 1e-6,
        max_nodes=50,
        lod_level=1,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    # Boundary edges survive instead of being dropped for an off-screen endpoint.
    assert {"e_b_c_1", "e_c_d_1", "e_c_e_1"} <= returned_edge_ids
    # And every endpoint of a returned edge is present as a node, so the client
    # keeps them.
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids
    # The off-screen neighbors were surfaced alongside the in-viewport node.
    assert {"c", "b", "d", "e"} <= returned_node_ids


def test_detail_viewport_keeps_boundary_edges_when_node_budget_is_saturated(
    tmp_path,
) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    cx, cy = positions["c"]

    # max_nodes=1 makes the in-viewport slice saturate the budget with only
    # "c". Previously this collapsed the neighbor budget to zero and dropped
    # every boundary edge again; now the off-screen neighbors are surfaced in
    # full so the boundary edges survive.
    read = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=cx - 1e-6,
        xmax=cx + 1e-6,
        ymin=cy - 1e-6,
        ymax=cy + 1e-6,
        max_nodes=1,
        lod_level=1,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    assert {"e_b_c_1", "e_c_d_1", "e_c_e_1"} <= returned_edge_ids
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids
    assert {"c", "b", "d", "e"} <= returned_node_ids


def test_read_region_returns_only_inside_nodes_and_internal_edges(
    tmp_path,
) -> None:
    # A box tight around only the "b"-"c" pair must return those two nodes and
    # the single edge between them (an internal edge), while the edges leaving
    # the box (a-b, c-d, c-e) are dropped entirely — no boundary edges, no
    # off-screen neighbors surfaced (unlike read_viewport's detail path).
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    bx, by = positions["b"]
    cx, cy = positions["c"]

    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=min(bx, cx) - 1e-6,
        xmax=max(bx, cx) + 1e-6,
        ymin=min(by, cy) - 1e-6,
        ymax=max(by, cy) + 1e-6,
        max_nodes=50,
    )

    returned_node_ids = {node.node_id for node in read.nodes}
    returned_edge_ids = {edge.edge_id for edge in read.edges}

    assert returned_node_ids == {"b", "c"}
    # Only the internal b-c edge survives; every edge references a returned node.
    assert returned_edge_ids == {"e_b_c_1"}
    for edge in read.edges:
        assert edge.source in returned_node_ids
        assert edge.target in returned_node_ids


def test_read_region_aggregates_selected_member_metadata(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset_with_metadata())
    layout_version = result.artifacts.layout_version

    full = store.read_viewport(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=50,
        lod_level=1,
    )
    positions = {node.node_id: (node.x, node.y) for node in full.nodes}
    xs = [positions[nid][0] for nid in positions]
    ys = [positions[nid][1] for nid in positions]

    # A box covering the whole layout selects every member.
    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=min(xs) - 1.0,
        xmax=max(xs) + 1.0,
        ymin=min(ys) - 1.0,
        ymax=max(ys) + 1.0,
        max_nodes=50,
    )

    assert {node.node_id for node in read.nodes} == {"a", "b", "c", "d", "e"}
    # region north(a,b) south(c,d) east(e) -> mode "north"/"south" tie broken
    # alphabetically to "north"; score mean = (10+20+30+5+15)/5 = 16.0.
    assert read.aggregated_metadata["region"] == "north"
    assert read.aggregated_metadata["score"] == 16.0
    assert read.aggregated_metadata[INTERNAL_COUNT_KEY] == 10


def test_read_region_empty_box_returns_empty(tmp_path) -> None:
    store = PreparedLayoutStore(tmp_path)
    worker = PreparedLayoutWorker(store)
    result = worker.prepare_dataset(_dataset())
    layout_version = result.artifacts.layout_version

    read = store.read_region(
        dataset_id=DATASET_ID,
        layout_version=layout_version,
        xmin=1e9,
        xmax=1e9 + 1.0,
        ymin=1e9,
        ymax=1e9 + 1.0,
        max_nodes=50,
    )

    assert read.nodes == ()
    assert read.edges == ()
    assert read.total_node_count == 0
    assert read.aggregated_metadata == {}


def test_prepare_layout_rejects_missing_distances() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name="missing-distance",
            content="(a,b);",
        )
    ).dataset

    try:
        prepare_layout_artifacts(dataset)
    except PreparedLayoutIngestError as error:
        assert "distance" in str(error).lower()
    else:
        raise AssertionError("Expected PreparedLayoutIngestError")
