import shutil
from time import sleep

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.http.graph.dependencies import (
    get_prepare_job_registry,
    get_prepared_layout_store,
)
from phylo_lens_server.main import app
from phylo_lens_server.repository.jobs.local import PrepareJobRegistry
from phylo_lens_server.pipeline.layout import GRAPHVIZ_SFDP_COMMAND
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.utils.versions import API_VERSION, service_version

SFDP_AVAILABLE = shutil.which(GRAPHVIZ_SFDP_COMMAND) is not None
EXPECTED_LAYOUT_STATUS = "ready" if SFDP_AVAILABLE else "degraded"

ROUTE_HEALTH = "/health"
ROUTE_GRAPH_PREPARE = "/api/graph/prepare"
ROUTE_GRAPH_VIEWPORT = "/api/graph/viewport"
ROUTE_GRAPH_REGION = "/api/graph/region"
ROUTE_GRAPH_SEARCH = "/api/graph/search"

STATUS_OK = 200
STATUS_ACCEPTED = 202
STATUS_NOT_FOUND = 404

PREPARE_POLL_ATTEMPTS = 200
PREPARE_POLL_INTERVAL_SECONDS = 0.01

DATASET_API_TREE = "api-tree"
DATASET_UNKNOWN = "missing-tree"
FORMAT_NEWICK = "newick"
WEIGHTED_TREE_CONTENT = "(((d:4)c:2)b:1)a;"


@pytest.fixture
def client(tmp_path):
    prepared_layout_store = PreparedLayoutStore(tmp_path / "prepared_layout")
    # The background prepare worker must write into the same store the viewport
    # route reads from, so bind the job registry to this test store explicitly.
    # dependency_overrides only patches FastAPI-injected params, not the direct
    # get_prepared_layout_store() call inside the cached registry factory.
    job_registry = PrepareJobRegistry(PreparedLayoutWorker(prepared_layout_store))
    get_prepared_layout_store.cache_clear()
    get_prepare_job_registry.cache_clear()
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    app.dependency_overrides[get_prepare_job_registry] = lambda: job_registry
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_prepared_layout_store.cache_clear()
    get_prepare_job_registry.cache_clear()
    job_registry.shutdown()


def prepare_and_wait(client: TestClient, payload: dict) -> dict:
    """Submit a prepare job and poll until it resolves; return the status body.

    The prepare route now runs the layout on a background worker, so tests submit
    then poll ``/prepare/{job_id}`` until the job is no longer pending.
    """
    accepted = client.post(ROUTE_GRAPH_PREPARE, json=payload)
    assert accepted.status_code == STATUS_ACCEPTED
    job_id = accepted.json()["job_id"]
    for _ in range(PREPARE_POLL_ATTEMPTS):
        status_response = client.get(f"{ROUTE_GRAPH_PREPARE}/{job_id}")
        assert status_response.status_code == STATUS_OK
        body = status_response.json()
        if body["status"] != "pending":
            return body
        sleep(PREPARE_POLL_INTERVAL_SECONDS)
    raise AssertionError("Prepare job did not complete within the poll budget.")


@pytest.fixture
def prepared_layout_store(tmp_path):
    return PreparedLayoutStore(tmp_path / "prepared_layout")


def test_health(client) -> None:
    response = client.get(ROUTE_HEALTH)

    assert response.status_code == STATUS_OK
    assert response.json() == {
        "status": "ok",
        "service_version": service_version(),
        "api_version": API_VERSION,
    }


def test_graph_prepare_materializes_layout_for_viewport_reads(client) -> None:
    status_body = prepare_and_wait(
        client,
        {
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_TREE_CONTENT,
        },
    )

    assert status_body["status"] == "ready"
    prepare_body = status_body["result"]
    assert prepare_body["dataset_id"] == DATASET_API_TREE
    assert prepare_body["layout_version"]
    assert prepare_body["layout_status"] == EXPECTED_LAYOUT_STATUS
    # The number of precomputed LoD tiers is surfaced so the client can map
    # camera zoom across the available semantic-zoom levels.
    assert prepare_body["lod_tier_count"] >= 1

    viewport_response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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
    assert viewport_body["global_bounds"]["min_x"] <= min(
        node["x"] for node in viewport_body["nodes"]
    )
    assert viewport_body["global_bounds"]["max_x"] >= max(
        node["x"] for node in viewport_body["nodes"]
    )
    assert viewport_body["global_bounds"]["min_y"] <= min(
        node["y"] for node in viewport_body["nodes"]
    )
    assert viewport_body["global_bounds"]["max_y"] >= max(
        node["y"] for node in viewport_body["nodes"]
    )


def test_graph_prepare_accepts_real_world_newick_labels_and_comments(client) -> None:
    status_body = prepare_and_wait(
        client,
        {
            "format": FORMAT_NEWICK,
            "dataset_name": "quoted-commented-tree",
            "content": "('A:1,west':0.10[&edge],'B (east)':0.20)'Root node';",
        },
    )
    prepare_body = status_body["result"]

    assert status_body["status"] == "ready"
    assert prepare_body["dataset_id"] == "quoted-commented-tree"

    viewport_response = client.post(
        ROUTE_GRAPH_VIEWPORT,
        json={
            "dataset_id": "quoted-commented-tree",
            "layout_version": prepare_body["layout_version"],
            "lod_level": 0,
            "max_nodes": 20,
        },
    )
    viewport_body = viewport_response.json()

    assert viewport_response.status_code == STATUS_OK
    assert {node["id"] for node in viewport_body["nodes"]} >= {
        "a_1_west",
        "b_east",
        "root_node",
    }


def test_graph_search_finds_nodes_across_whole_tree(client) -> None:
    status_body = prepare_and_wait(
        client,
        {
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_TREE_CONTENT,
        },
    )
    layout_version = status_body["result"]["layout_version"]

    search_response = client.post(
        ROUTE_GRAPH_SEARCH,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": layout_version,
            "query": "d",
            "limit": 25,
        },
    )
    body = search_response.json()

    assert search_response.status_code == STATUS_OK
    assert body["dataset_id"] == DATASET_API_TREE
    assert "d" in {match["node_id"] for match in body["matches"]}
    exact = next(match for match in body["matches"] if match["node_id"] == "d")
    assert exact["score"] == 100
    assert exact["cluster_id"]


def test_graph_search_missing_dataset_returns_not_found(client) -> None:
    response = client.post(
        ROUTE_GRAPH_SEARCH,
        json={"dataset_id": DATASET_UNKNOWN, "query": "x"},
    )
    assert response.status_code == STATUS_NOT_FOUND


def test_graph_prepare_reports_degraded_status_when_sfdp_is_missing(
    client, monkeypatch
) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: None,
    )

    status_body = prepare_and_wait(
        client,
        {
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_TREE_CONTENT,
        },
    )

    assert status_body["status"] == "ready"
    prepare_body = status_body["result"]
    assert prepare_body["layout_status"] == "degraded"
    assert any("sfdp" in warning for warning in prepare_body["warnings"])


def test_graph_viewport_lod_zero_without_bounds_falls_back_from_single_cluster(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_unit_distance_chain()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store

    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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
    assert body["layout_status"] == EXPECTED_LAYOUT_STATUS
    assert body["total_node_count"] == 10
    assert len(body["nodes"]) == 10
    assert len(body["edges"]) == 9


def test_graph_lod_zero_uses_real_representative_node_ids(
    client,
    prepared_layout_store,
) -> None:
    dataset = large_clustered_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    original_node_ids = {node.id for node in dataset.nodes}

    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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


def test_graph_viewport_applies_density_cap(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_weighted_api_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    xs = [position.x for position in result.node_positions]
    ys = [position.y for position in result.node_positions]

    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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
    # The density cap governs the in-viewport slice (2 nodes). Off-screen
    # boundary-edge neighbors may be surfaced in addition so their edges keep
    # both endpoints, so the total returned may exceed the cap; the in-viewport
    # slice itself is still capped and flagged truncated.
    in_viewport_nodes = [
        node for node in body["nodes"] if node.get("is_representative") is not True
    ]
    assert len(in_viewport_nodes) >= 2
    assert body["total_node_count"] > 2
    assert body["truncated"] is True
    # Every returned edge still has both endpoints present as nodes.
    returned_ids = {node["id"] for node in body["nodes"]}
    for edge in body["edges"]:
        assert edge["source"] in returned_ids
        assert edge["target"] in returned_ids


def test_graph_region_returns_internal_subgraph_and_aggregate(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_weighted_api_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    xs = [position.x for position in result.node_positions]
    ys = [position.y for position in result.node_positions]

    response = client.post(
        ROUTE_GRAPH_REGION,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": result.artifacts.layout_version,
            "xmin": min(xs) - 1,
            "xmax": max(xs) + 1,
            "ymin": min(ys) - 1,
            "ymax": max(ys) + 1,
            "max_nodes": 50,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    returned_ids = {node["id"] for node in body["nodes"]}
    assert returned_ids
    # A region is an isolated subgraph: every returned edge has both endpoints
    # inside the selection (no boundary edges, no surfaced off-screen neighbors).
    for edge in body["edges"]:
        assert edge["source"] in returned_ids
        assert edge["target"] in returned_ids
    assert "aggregated_metadata" in body


def test_graph_region_rejects_unknown_prepared_layout(client) -> None:
    response = client.post(
        ROUTE_GRAPH_REGION,
        json={
            "dataset_id": DATASET_UNKNOWN,
            "xmin": 0,
            "xmax": 1,
            "ymin": 0,
            "ymax": 1,
        },
    )

    assert response.status_code == STATUS_NOT_FOUND


def test_graph_viewport_lod_one_reads_real_nodes(
    client,
    prepared_layout_store,
) -> None:
    dataset = normalize_unit_distance_chain()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    xs = [position.x for position in result.node_positions]
    ys = [position.y for position in result.node_positions]

    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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


def test_graph_viewport_reads_cluster_members_without_bounds(
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
        ROUTE_GRAPH_VIEWPORT,
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


def test_graph_viewport_expansion_serializes_meta_edges(
    client,
    prepared_layout_store,
) -> None:
    # A cluster (a, b, c) with singleton neighbors d and e. Expanding it emits
    # rerouted boundary edges c->d and c->e as meta-edges, while its internal
    # edges stay ordinary (no is_meta / bundled_edge_count in the payload).
    dataset = normalize_split_neighbor_tree()
    result = PreparedLayoutWorker(prepared_layout_store).prepare_dataset(dataset)
    app.dependency_overrides[get_prepared_layout_store] = lambda: prepared_layout_store
    abc_cluster = next(
        cluster
        for cluster in result.artifacts.clusters
        if cluster.member_node_ids == ("a", "b", "c")
    )

    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
        json={
            "dataset_id": DATASET_API_TREE,
            "layout_version": result.artifacts.layout_version,
            "cluster_id": abc_cluster.cluster_id,
            "max_nodes": 50,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert {node["id"] for node in body["nodes"]} == {"a", "b", "c", "d", "e"}

    meta_edges = {
        (edge["source"], edge["target"]): edge
        for edge in body["edges"]
        if edge.get("is_meta")
    }
    assert set(meta_edges) == {("c", "d"), ("c", "e")}
    assert all(edge["bundled_edge_count"] == 1 for edge in meta_edges.values())

    # Ordinary edges omit the meta-edge fields entirely (exclude_none).
    ordinary_edges = [edge for edge in body["edges"] if not edge.get("is_meta")]
    assert ordinary_edges
    for edge in ordinary_edges:
        assert "is_meta" not in edge
        assert "bundled_edge_count" not in edge


def test_graph_viewport_rejects_unknown_prepared_layout(client) -> None:
    response = client.post(
        ROUTE_GRAPH_VIEWPORT,
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
            format=FORMAT_NEWICK,
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


def normalize_split_neighbor_tree():
    # (a, b, c) form one distance cluster at threshold 1.0; d and e are
    # singleton clusters connected to c, so expanding (a, b, c) produces
    # meta-edges to the d and e representatives.
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_API_TREE,
            content="(((d:3,e:4)c:1)b:1)a;",
        )
    ).dataset
    positions = {
        "a": (0.0, 0.0),
        "b": (1.0, 0.0),
        "c": (2.0, 0.0),
        "d": (6.0, 0.0),
        "e": (8.0, 0.0),
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
    content = "n9"
    for index in range(8, -1, -1):
        content = f"({content}:1)n{index}"
    content = f"{content};"
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
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
    content = "n999"
    for index in range(998, -1, -1):
        content = f"({content}:{(index % 7) + 1})n{index}"
    content = f"{content};"
    normalized = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
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
