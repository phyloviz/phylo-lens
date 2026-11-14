from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    prepare_layout_artifacts,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.preparation import DATASET_ID, FORMAT_NEWICK
from tests.support.preparation import varied_chain_dataset as _varied_chain_dataset
from tests.support.preparation import weighted_tree as _dataset

EXPECTED_LAYOUT_STATUS = "ready"


def test_preparation_service_persists_ready_cluster_and_node_positions(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)

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


def test_preparation_service_keeps_previous_ready_version_until_replaced(
    tmp_path,
) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PreparationService(store)

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
    store = SQLiteLayoutRepository(tmp_path)
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


def test_unweighted_newick_keeps_absent_distances_through_persistence(tmp_path) -> None:
    dataset = ingest_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name="unweighted-tree",
            content="(a,b)root;",
        ).to_domain()
    ).dataset
    assert all(edge.distance is None for edge in dataset.edges)

    store = SQLiteLayoutRepository(tmp_path)
    result = PreparationService(store).prepare_dataset(dataset)
    read = store.read_viewport(
        dataset_id=dataset.dataset_id,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=10,
    )
    assert all(edge.distance is None for edge in read.edges)
