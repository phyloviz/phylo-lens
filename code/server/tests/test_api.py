from fastapi.testclient import TestClient

from phylo_lens_server.main import app

ROUTE_HEALTH = "/health"
ROUTE_NORMALIZE = "/dataset/normalize"

STATUS_OK = 200
STATUS_BAD_REQUEST = 400

KEY_STATUS = "status"
STATUS_VALUE_OK = "ok"

KEY_DATASET = "dataset"
KEY_DATASET_ID = "dataset_id"
KEY_STATS = "stats"
KEY_NODE_COUNT = "node_count"

DATASET_API_TREE = "api-tree"
DATASET_BROKEN = "broken"

FORMAT_NEWICK = "newick"
VALID_NEWICK_CONTENT = "(A,B)Root;"
INVALID_NEWICK_CONTENT = "(A,BRoot;"

client = TestClient(app)


def test_health() -> None:
    """Verify the liveness route answers with a healthy status payload."""
    response = client.get(ROUTE_HEALTH)
    assert response.status_code == STATUS_OK
    assert response.json() == {KEY_STATUS: STATUS_VALUE_OK}


def test_normalize_endpoint_accepts_newick() -> None:
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


def test_normalize_endpoint_rejects_invalid_payload() -> None:
    """Ensure malformed Newick input is rejected as bad request."""
    payload = {
        "format": FORMAT_NEWICK,
        "dataset_name": DATASET_BROKEN,
        "content": INVALID_NEWICK_CONTENT,
    }

    response = client.post(ROUTE_NORMALIZE, json=payload)

    assert response.status_code == STATUS_BAD_REQUEST
