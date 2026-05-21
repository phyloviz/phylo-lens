import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.api.routes import get_dataset_store
from phylo_lens_server.data.store import DatasetStore
from phylo_lens_server.main import app

ROUTE_HEALTH = "/health"
ROUTE_NORMALIZE = "/dataset/normalize"
ROUTE_PREPARE = "/dataset/prepare"
ROUTE_VIEW_SLICE = "/dataset/view-slice"

STATUS_OK = 200
STATUS_BAD_REQUEST = 400
STATUS_NOT_FOUND = 404

KEY_STATUS = "status"
STATUS_VALUE_OK = "ok"

KEY_DATASET = "dataset"
KEY_DATASET_ID = "dataset_id"
KEY_STATS = "stats"
KEY_NODE_COUNT = "node_count"
KEY_CACHE_HIT = "cache_hit"
KEY_HIERARCHY_MS = "hierarchy_ms"
KEY_LAYOUT_MS = "layout_ms"
KEY_LOD_LEVEL = "lod_level"
KEY_NODES = "nodes"
KEY_COLLAPSED_CLUSTERS = "collapsed_clusters"
KEY_DATASET_ID_TOP = "dataset_id"
KEY_WARNINGS = "warnings"
HEADER_ACCESS_CONTROL_ALLOW_ORIGIN = "access-control-allow-origin"
HEADER_ACCESS_CONTROL_REQUEST_METHOD = "Access-Control-Request-Method"
HEADER_ORIGIN = "Origin"

DATASET_API_TREE = "api-tree"
DATASET_API_TREE_COPY = "api-tree-copy"
DATASET_BROKEN = "broken"
DATASET_UNKNOWN = "missing-tree"

FORMAT_NEWICK = "newick"
FORMAT_EDGELIST = "edgelist"
CLIENT_ORIGIN_LOCALHOST_3000 = "http://localhost:3000"
VALID_NEWICK_CONTENT = "(A,B)Root;"
INVALID_NEWICK_CONTENT = "(A,BRoot;"
WEIGHTED_TREE_CONTENT = "source,target,distance\na,b,1\nb,c,2\nc,d,4\n"
WEIGHTED_NEWICK_CONTENT = "(A:1,(B:2,C:4)N:3)R;"
NEGATIVE_BRANCH_NEWICK_CONTENT = "(A:-0.001,B:0.2)R:0;"


@pytest.fixture
def client(tmp_path):
    """Build a test client with an isolated prepared-dataset store."""
    store = DatasetStore(tmp_path)
    app.dependency_overrides[get_dataset_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_health(client) -> None:
    """Verify the liveness route answers with a healthy status payload."""
    response = client.get(ROUTE_HEALTH)
    assert response.status_code == STATUS_OK
    assert response.json() == {KEY_STATUS: STATUS_VALUE_OK}


def test_normalize_endpoint_accepts_newick(client) -> None:
    """Ensure normalization succeeds for a valid Newick payload."""
    payload = {
        "format": FORMAT_NEWICK,
        "dataset_name": DATASET_API_TREE,
        "content": VALID_NEWICK_CONTENT,
    }

    response = client.post(ROUTE_NORMALIZE, json=payload)
    body = response.json()

    assert response.status_code == STATUS_OK
    assert body[KEY_DATASET][KEY_DATASET_ID] == DATASET_API_TREE
    assert body[KEY_STATS][KEY_NODE_COUNT] == 3


def test_normalize_endpoint_rejects_invalid_payload(client) -> None:
    """Ensure malformed Newick input is rejected as bad request."""
    payload = {
        "format": FORMAT_NEWICK,
        "dataset_name": DATASET_BROKEN,
        "content": INVALID_NEWICK_CONTENT,
    }

    response = client.post(ROUTE_NORMALIZE, json=payload)

    assert response.status_code == STATUS_BAD_REQUEST


def test_prepare_endpoint_accepts_unweighted_newick_with_unit_distances(
    client,
) -> None:
    """Ensure basic Newick input can still be prepared for the client workbench."""
    payload = {
        "format": FORMAT_NEWICK,
        "dataset_name": DATASET_API_TREE,
        "content": VALID_NEWICK_CONTENT,
    }

    response = client.post(ROUTE_PREPARE, json=payload)
    body = response.json()

    assert response.status_code == STATUS_OK
    assert body[KEY_DATASET_ID_TOP] == DATASET_API_TREE
    assert body[KEY_STATS][KEY_NODE_COUNT] == 3
    assert "unit distance" in body[KEY_WARNINGS][0]


def test_prepare_endpoint_accepts_cors_preflight_from_vite_dev_server(
    client,
) -> None:
    """Ensure the local frontend dev server can preflight prepare requests."""
    response = client.options(
        ROUTE_PREPARE,
        headers={
            HEADER_ORIGIN: CLIENT_ORIGIN_LOCALHOST_3000,
            HEADER_ACCESS_CONTROL_REQUEST_METHOD: "POST",
        },
    )

    assert response.status_code == STATUS_OK
    assert (
        response.headers[HEADER_ACCESS_CONTROL_ALLOW_ORIGIN]
        == CLIENT_ORIGIN_LOCALHOST_3000
    )


def test_view_slice_endpoint_returns_overview_for_prepared_weighted_newick(
    client,
) -> None:
    """Ensure a prepared weighted dataset can be queried through the visible-slice endpoint."""
    client.post(
        ROUTE_PREPARE,
        json={
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_NEWICK_CONTENT,
        },
    )

    response = client.post(
        ROUTE_VIEW_SLICE,
        json={
            "dataset_id": DATASET_API_TREE,
            "viewport": {"x": 0, "y": 0, "width": 1000, "height": 600},
            "zoom": 0.4,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert body[KEY_DATASET_ID_TOP] == DATASET_API_TREE
    assert body[KEY_LOD_LEVEL] >= 0
    assert len(body[KEY_NODES]) >= 1
    assert all("x" in node and "y" in node for node in body[KEY_NODES])


def test_prepare_endpoint_clamps_negative_newick_branch_lengths(client) -> None:
    """Ensure RapidNJ-style negative branch lengths do not become API 500s."""
    response = client.post(
        ROUTE_PREPARE,
        json={
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": NEGATIVE_BRANCH_NEWICK_CONTENT,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert body[KEY_DATASET_ID_TOP] == DATASET_API_TREE
    assert "clamped" in body[KEY_WARNINGS][0]


def test_view_slice_endpoint_rejects_unknown_dataset(client) -> None:
    """Ensure view-slice fails cleanly for unknown prepared dataset ids."""
    response = client.post(
        ROUTE_VIEW_SLICE,
        json={
            "dataset_id": DATASET_UNKNOWN,
            "viewport": {"x": 0, "y": 0, "width": 1000, "height": 600},
            "zoom": 0.4,
        },
    )

    assert response.status_code == STATUS_NOT_FOUND


def test_prepare_and_view_slice_use_threshold_hierarchy_for_weighted_edgelist(
    client,
) -> None:
    """Ensure weighted edge-lists can use the threshold hierarchy path."""
    prepare_response = client.post(
        ROUTE_PREPARE,
        json={
            "format": FORMAT_EDGELIST,
            "dataset_name": DATASET_API_TREE,
            "content": WEIGHTED_TREE_CONTENT,
        },
    )

    assert prepare_response.status_code == STATUS_OK

    response = client.post(
        ROUTE_VIEW_SLICE,
        json={
            "dataset_id": DATASET_API_TREE,
            "viewport": {"x": 0, "y": 0, "width": 8000, "height": 5000},
            "zoom": 2.0,
            "max_nodes": 4,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert [node["id"] for node in body[KEY_NODES]] == ["a", "b", "d"]
    assert [(edge["source"], edge["target"]) for edge in body["edges"]] == [
        ("a", "b"),
        ("a", "d"),
    ]


def test_prepare_endpoint_reuses_cached_hierarchy_for_repeated_payload(client) -> None:
    """Ensure repeated prepares skip expensive hierarchy work for the same payload."""
    payload = {
        "format": FORMAT_EDGELIST,
        "dataset_name": DATASET_API_TREE,
        "content": WEIGHTED_TREE_CONTENT,
    }

    first_response = client.post(ROUTE_PREPARE, json=payload)
    second_response = client.post(ROUTE_PREPARE, json=payload)

    first_stats = first_response.json()[KEY_STATS]
    second_stats = second_response.json()[KEY_STATS]

    assert first_response.status_code == STATUS_OK
    assert second_response.status_code == STATUS_OK
    assert first_stats[KEY_CACHE_HIT] is False
    assert second_stats[KEY_CACHE_HIT] is True
    assert first_stats[KEY_HIERARCHY_MS] > 0
    assert second_stats[KEY_HIERARCHY_MS] == 0.0
    assert second_stats[KEY_LAYOUT_MS] == 0.0


def test_prepare_cache_retargets_same_payload_to_new_dataset_id(client) -> None:
    """Ensure cached prepared records can be reused under a different dataset id."""
    first_payload = {
        "format": FORMAT_EDGELIST,
        "dataset_name": DATASET_API_TREE,
        "content": WEIGHTED_TREE_CONTENT,
    }
    second_payload = {
        **first_payload,
        "dataset_name": DATASET_API_TREE_COPY,
    }

    client.post(ROUTE_PREPARE, json=first_payload)
    prepare_response = client.post(ROUTE_PREPARE, json=second_payload)
    view_response = client.post(
        ROUTE_VIEW_SLICE,
        json={
            "dataset_id": DATASET_API_TREE_COPY,
            "viewport": {"x": 0, "y": 0, "width": 1000, "height": 600},
            "zoom": 2.0,
            "max_nodes": 4,
        },
    )

    assert prepare_response.status_code == STATUS_OK
    assert prepare_response.json()[KEY_DATASET_ID_TOP] == DATASET_API_TREE_COPY
    assert prepare_response.json()[KEY_STATS][KEY_CACHE_HIT] is True
    assert view_response.status_code == STATUS_OK
    assert view_response.json()[KEY_DATASET_ID_TOP] == DATASET_API_TREE_COPY
