"""Metadata updates use a persisted fixture; no layout executable is required."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.database.sqlite import connect
from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store
from phylo_lens_server.http.graph.schemas import GraphAncillaryRequest
from phylo_lens_server.main import app
from phylo_lens_server.repository.layout import ancillary_revision
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.services import graph_service

DATASET = "tree"
SOURCE = "original"
TABLE = "id,country,age\nA,Portugal,10\nA,Canada,10\nB,Portugal,30\nmissing,Spain,40\n"


@pytest.fixture
def store(tmp_path):
    store = PreparedLayoutStore(tmp_path)
    with connect(store.path) as db:
        db.execute(
            "insert into datasets(dataset_id, layout_version, status) values (?, ?, 'ready')",
            (DATASET, SOURCE),
        )
        for node_id, x in (("Root", 0), ("A", 1), ("B", 2)):
            db.execute(
                "insert into node_positions values (?, ?, ?, ?, ?, 0, 'ready')",
                (DATASET, SOURCE, node_id, node_id, x),
            )
            db.execute(
                "insert into prepared_clusters values (?, ?, ?, 0, ?, 1, ?, 0, 0, ?, ?, 0, 0, 'ready')",
                (DATASET, SOURCE, node_id, node_id, x, x, x),
            )
            db.execute(
                "insert into cluster_members values (?, ?, ?, ?)",
                (DATASET, SOURCE, node_id, node_id),
            )
            db.execute(
                "insert into cluster_members values (?, ?, 'all', ?)",
                (DATASET, SOURCE, node_id),
            )
        db.execute(
            "insert into prepared_clusters values (?, ?, 'all', 2, 'Root', 3, 1, 0, 1, 0, 2, 0, 0, 'ready')",
            (DATASET, SOURCE),
        )
        for node_id in ("A", "B"):
            db.execute(
                "insert into graph_edges values (?, ?, ?, 'Root', ?, 1)",
                (DATASET, SOURCE, node_id, node_id),
            )
            db.execute(
                "insert into prepared_edges values (?, ?, 1, ?, 'Root', ?, 1)",
                (DATASET, SOURCE, node_id, node_id),
            )
    return store


@pytest.fixture
def client(store, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Ancillary update must not start graph preparation")

    monkeypatch.setattr(graph_service, "normalize_dataset", forbidden)
    monkeypatch.setattr(graph_service, "prepare_graph_job", forbidden)
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.pop(get_prepared_layout_store, None)


def request(content=TABLE, version=SOURCE):
    return {
        "dataset_id": DATASET,
        "layout_version": version,
        "ancillary_data": {"format": "csv", "join_column": "id", "content": content},
    }


def table_rows(store, table, version):
    with connect(store.path) as db:
        rows = db.execute(
            f"select * from {table} where dataset_id = ? and layout_version = ?",
            (DATASET, version),
        ).fetchall()
    return sorted(
        [
            tuple(value for key, value in dict(row).items() if key != "layout_version")
            for row in rows
        ],
        key=repr,
    )


def test_apply_preserves_all_geometry_and_source_and_updates_read_apis(client, store):
    geometry = {
        table: table_rows(store, table, SOURCE)
        for table in ancillary_revision.GEOMETRY_COLUMNS
    }
    response = client.put("/api/graph/ancillary", json=request())
    assert response.status_code == 200, response.text
    result = response.json()
    version = result["layout_version"]
    assert version != SOURCE
    assert store.latest_layout_version(DATASET) == version
    assert result["matched_node_count"] == 2
    assert any("missing" in warning for warning in result["warnings"])
    for table, rows in geometry.items():
        assert table_rows(store, table, SOURCE) == rows
        assert table_rows(store, table, version) == rows
    assert table_rows(store, "node_metadata", SOURCE) == []

    query = {"dataset_id": DATASET, "layout_version": version}
    finest = client.post("/api/graph/viewport", json={**query, "lod_level": 1}).json()
    nodes = {node["id"]: node for node in finest["nodes"]}
    assert nodes["A"]["metadata"]["age"] == 10
    assert nodes["A"]["metadata"]["profile_count"] == 2
    assert nodes["A"]["metadata"]["__category_count__country__value__Portugal"] == 1
    assert nodes["B"]["metadata"]["country"] == "Portugal"
    coarse = client.post(
        "/api/graph/viewport",
        json={**query, "lod_level": 0, "xmin": -1, "xmax": 3, "ymin": -1, "ymax": 1},
    ).json()
    assert (
        coarse["nodes"][0]["metadata"]["__category_count__country__value__Portugal"]
        == 2
    )
    assert coarse["nodes"][0]["metadata"]["profile_count"] == 3
    assert all(not field["key"].startswith("__") for field in finest["metadata_schema"])
    search = client.post(
        "/api/graph/search", json={**query, "query": "Portugal"}
    ).json()
    assert {node["node_id"] for node in search["matches"]} == {"A", "B"}
    region = client.post(
        "/api/graph/region",
        json={**query, "xmin": -1, "xmax": 3, "ymin": -1, "ymax": 1},
    ).json()
    assert region["aggregated_metadata"]["age"] == 20


def test_replacement_drops_old_fields_and_is_idempotent(client, store):
    first = client.put("/api/graph/ancillary", json=request()).json()["layout_version"]
    assert (
        client.put("/api/graph/ancillary", json=request()).json()["layout_version"]
        == first
    )
    second = client.put(
        "/api/graph/ancillary", json=request("id,site\nA,North\n", first)
    ).json()["layout_version"]
    with connect(store.path) as db:
        rows = db.execute(
            "select node_id, metadata_json from node_metadata where layout_version = ?",
            (second,),
        ).fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0]["metadata_json"]) == {
        "site": "North",
        "profile_count": 1,
        "__category_count__site__value__North": 1,
    }
    assert len(table_rows(store, "node_metadata", first)) == 2


@pytest.mark.parametrize(
    "content",
    [
        " ",
        "id,country\nunknown,PT\n",
        "wrong,country\nA,PT\n",
        "id,profile_count\nA,x\n",
    ],
)
def test_invalid_table_publishes_nothing(client, store, content):
    response = client.put("/api/graph/ancillary", json=request(content))
    assert response.status_code == 400, response.text
    with connect(store.path) as db:
        assert db.execute("select count(*) from datasets").fetchone()[0] == 1


@pytest.mark.parametrize("version", ["missing", "pending"])
def test_requires_exact_published_version(client, store, version):
    with connect(store.path) as db:
        db.execute(
            "insert into datasets(dataset_id, layout_version, status) values (?, 'pending', 'refining')",
            (DATASET,),
        )
    assert (
        client.put("/api/graph/ancillary", json=request(version=version)).status_code
        == 404
    )


def test_failure_rolls_back_geometry_copy(client, store, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("injected metadata write failure")

    monkeypatch.setattr(ancillary_revision, "_insert_many", fail)
    assert client.put("/api/graph/ancillary", json=request()).status_code == 500
    with connect(store.path) as db:
        assert db.execute("select count(*) from datasets").fetchone()[0] == 1
        assert (
            db.execute(
                "select count(distinct layout_version) from node_positions"
            ).fetchone()[0]
            == 1
        )


def test_concurrent_identical_updates_publish_one_version(store):
    payload = GraphAncillaryRequest.model_validate(request())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: graph_service.apply_ancillary_data(payload, store), range(2)
            )
        )
    assert results[0].layout_version == results[1].layout_version
    with connect(store.path) as db:
        assert db.execute("select count(*) from datasets").fetchone()[0] == 2


def test_requires_a_source_version(client):
    payload = request()
    del payload["layout_version"]
    assert client.put("/api/graph/ancillary", json=payload).status_code == 422


def test_cors_allows_ancillary_upload(monkeypatch):
    from phylo_lens_server.main import create_app

    monkeypatch.setenv("PHYLO_LENS_CORS_ORIGINS", "https://host.example")
    with TestClient(create_app()) as client:
        response = client.options(
            "/api/graph/ancillary",
            headers={
                "Origin": "https://host.example",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://host.example"
