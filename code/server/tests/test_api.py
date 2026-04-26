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
KEY_LOD_LEVEL = "lod_level"
KEY_NODES = "nodes"
KEY_COLLAPSED_CLUSTERS = "collapsed_clusters"
KEY_DATASET_ID_TOP = "dataset_id"

DATASET_API_TREE = "api-tree"
DATASET_BROKEN = "broken"
DATASET_UNKNOWN = "missing-tree"

FORMAT_NEWICK = "newick"
FORMAT_EDGELIST = "edgelist"
VALID_NEWICK_CONTENT = "(A,B)Root;"
INVALID_NEWICK_CONTENT = "(A,BRoot;"
UNDIRECTED_TREE_CONTENT = "source,target\na,x\nx,b\nc,x\n"


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


def test_prepare_endpoint_accepts_newick_and_persists_hierarchy(client) -> None:
    """Ensure prepare builds hierarchy-backed state for later LoD queries."""
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
    assert "hierarchy_ms" in body[KEY_STATS]
    assert "store_ms" in body[KEY_STATS]


def test_view_slice_endpoint_returns_overview_for_prepared_dataset(client) -> None:
    """Ensure a prepared dataset can be queried through the visible-slice endpoint."""
    client.post(
        ROUTE_PREPARE,
        json={
            "format": FORMAT_NEWICK,
            "dataset_name": DATASET_API_TREE,
            "content": "((A,B)X,(C,D)Y)Root;",
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
    assert body[KEY_LOD_LEVEL] == 0
    assert [node["id"] for node in body[KEY_NODES]] == ["root", "x", "y"]
    assert [node["is_cluster_proxy"] for node in body[KEY_NODES]] == [True, True, True]
    assert [(edge["source"], edge["target"]) for edge in body["edges"]] == [
        ("root", "x"),
        ("root", "y"),
    ]
    assert [cluster["cluster_id"] for cluster in body[KEY_COLLAPSED_CLUSTERS]] == [
        "cluster_x",
        "cluster_y",
    ]


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


def test_prepare_and_view_slice_orient_undirected_tree_edgelist(client) -> None:
    """Ensure prepare roots undirected tree inputs before serving visible slices."""
    prepare_response = client.post(
        ROUTE_PREPARE,
        json={
            "format": FORMAT_EDGELIST,
            "dataset_name": DATASET_API_TREE,
            "content": UNDIRECTED_TREE_CONTENT,
        },
    )

    assert prepare_response.status_code == STATUS_OK

    response = client.post(
        ROUTE_VIEW_SLICE,
        json={
            "dataset_id": DATASET_API_TREE,
            "viewport": {"x": 0, "y": 0, "width": 1000, "height": 600},
            "zoom": 2.0,
        },
    )
    body = response.json()

    assert response.status_code == STATUS_OK
    assert [node["id"] for node in body[KEY_NODES]] == ["x", "a", "b", "c"]
    assert [(edge["source"], edge["target"]) for edge in body["edges"]] == [
        ("x", "a"),
        ("x", "b"),
        ("x", "c"),
    ]
