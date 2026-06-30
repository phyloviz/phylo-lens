import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.api.v2_graph import get_prepared_layout_store
from phylo_lens_server.main import app
from phylo_lens_server.prepared_layout.store import PreparedLayoutStore
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

ROUTE_HEALTH = "/health"
ROUTE_GRAPH_V2_PREPARE = "/api/v2/graph/prepare"
ROUTE_GRAPH_V2_VIEWPORT = "/api/v2/graph/viewport"

STATUS_OK = 200
STATUS_NOT_FOUND = 404

DATASET_API_TREE = "api-tree"
DATASET_UNKNOWN = "missing-tree"
FORMAT_EDGELIST = "edgelist"
WEIGHTED_TREE_CONTENT = "source,target,distance\na,b,1\nb,c,2\nc,d,4\n"


@pytest.fixture
def client(tmp_path):
    prepared_layout_store = PreparedLayoutStore(tmp_path / "prepared_layout")
    get_prepared_layout_store.cache_clear()
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_prepared_layout_store.cache_clear()


@pytest.fixture
def prepared_layout_store(tmp_path):
    return PreparedLayoutStore(tmp_path / "prepared_layout_v2")


def test_health(client) -> None:
    response = client.get(ROUTE_HEALTH)

    assert response.status_code == STATUS_OK
    assert response.json() == {"status": "ok"}


def test_graph_v2_prepare_materializes_layout_for_viewport_reads(client) -> None:
    prepare_response = client.post(
        ROUTE_GRAPH_V2_PREPARE,
        json={
            "format": FORMAT_EDGELIST,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_TREE_CONTENT,
        },
    )
    prepare_body = prepare_response.json()

    assert prepare_response.status_code == STATUS_OK
    assert prepare_body["dataset_id"] == DATASET_API_TREE
    assert prepare_body["layout_version"]
    assert prepare_body["layout_status"] == "ready"

    viewport_response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": prepare_body["layout_version"],
            "lod_level": 0,
            "max_nodes": 20,
        },
    )
    viewport_body = viewport_response.json()

    assert viewport_response.status_code == STATUS_OK
    assert {node["id"] for node in viewport_body["nodes"]} >= {"a", "b", "c", "d"}


def test_graph_v2_viewport_lod_zero_without_bounds_falls_back_from_single_cluster(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_unit_distance_chain()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store

    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": result.artifacts.layout_version,
            "zoom": 0.5,
            "lod_level": 0,
            "max_nodes": 20,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert body["lod_level"] == 0
    assert body["layout_status"] == "ready"
    assert body["total_node_count"] == 10
    assert len(body["nodes"]) == 10
    assert len(body["edges"]) == 9


def test_graph_v2_lod_zero_uses_real_representative_node_ids(
    client,
    prepared_layout_store,
) -> None:
    dataset = large_clustered_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    original_node_ids = {node.id for node in dataset.nodes}

    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": dataset.dataset_id,
            "layout_version": result.artifacts.layout_version,
            "lod_level": 0,
            "max_nodes": 1_000,
        },
    )
    body = response.json()
    visible_node_ids = {node["id"] for node in body["nodes"]}

    assert response.status_code == STATUS_OK
    assert body["nodes"]
    assert body["edges"]
    assert {node["id"] for node in body["nodes"]} <= original_node_ids
    assert all(edge["id"].startswith("quotient_edge:") for edge in body["edges"])
    assert all(edge["source"] in visible_node_ids for edge in body["edges"])
    assert all(edge["target"] in visible_node_ids for edge in body["edges"])


def test_graph_v2_viewport_applies_density_cap(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_weighted_api_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    xs = [position.x for position in result.node_positions]
    ys = [position.y for position in result.node_positions]

    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "xmin": min(xs) - 1,
            "xmax": max(xs) + 1,
            "ymin": min(ys) - 1,
            "ymax": max(ys) + 1,
            "max_nodes": 2,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert len(body["nodes"]) == 2
    assert body["total_node_count"] > 2
    assert body["truncated"] is True


def test_graph_v2_viewport_lod_one_reads_real_nodes(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_unit_distance_chain()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    xs = [position.x for position in result.node_positions]
    ys = [position.y for position in result.node_positions]

    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": result.artifacts.layout_version,
            "xmin": min(xs) - 1,
            "xmax": max(xs) + 1,
            "ymin": min(ys) - 1,
            "ymax": max(ys) + 1,
            "lod_level": 1,
            "max_nodes": 50,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert {node["id"] for node in body["nodes"]} == {
        f"n{index}" for index in range(10)
    }
    assert all(not node["is_representative"] for node in body["nodes"])


def test_graph_v2_viewport_reads_cluster_members_without_bounds(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_unit_distance_chain()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    cluster = next(
        cluster for cluster in result.artifacts.clusters if cluster.member_count > 1
    )

    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": result.artifacts.layout_version,
            "cluster_id": cluster.cluster_id,
            "max_nodes": 50,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert {node["id"] for node in body["nodes"]} == set(cluster.member_node_ids)
    assert all(not node["is_representative"] for node in body["nodes"])
    assert all(node["member_count"] == 1 for node in body["nodes"])
    assert body["edges"]


def test_graph_v2_viewport_rejects_unknown_prepared_layout(client) -> None:
    response = client.post(
        ROUTE_GRAPH_V2_VIEWPORT,
        json={
            "dataset_id": DATASET_UNKNOWN,
            "xmin": 0,
            "xmax": 1,
            "ymin": 0,
            "ymax": 1,
        },
    )

    assert response.status_code == STATUS_NOT_FOUND


def normalize_weighted_api_tree():
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_API_TREE,
            content=WEIGHTED_TREE_CONTENT,
        )
    ).dataset
    positions = {
        "a": (0.0, 0.0),
        "b": (1.0, 0.0),
        "c": (2.0, 0.0),
        "d": (3.0, 0.0),
    }
    return normalized.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": positions[node.id][0],
                        "y": positions[node.id][1],
                    }
                )
                for node in normalized.nodes
            ]
        }
    )


def normalize_unit_distance_chain():
    content = "source,target,distance\n" + "\n".join(
        f"n{index},n{index + 1},1" for index in range(9)
    )
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_API_TREE,
            content=content,
        )
    ).dataset
    return normalized.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": float(int(node.id.removeprefix("n"))),
                        "y": 0.0,
                    }
                )
                for node in normalized.nodes
            ]
        }
    )


def large_clustered_tree():
    content = "source,target,distance\n" + "\n".join(
        f"n{index},n{index + 1},{(index % 7) + 1}" for index in range(999)
    )
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name="large-clustered-tree",
            content=content,
        )
    ).dataset
    return normalized.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={
                        "x": float(int(node.id.removeprefix("n"))),
                        "y": 0.0,
                    }
                )
                for node in normalized.nodes
            ]
        }
    )
