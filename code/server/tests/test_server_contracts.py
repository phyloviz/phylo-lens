"""API regression captures from the pre-refactor server, with fixed geometry."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.http.graph.dependencies import (
    get_prepare_job_registry,
    get_prepared_layout_store,
)
from phylo_lens_server.jobs.executor import PrepareExecutor
from phylo_lens_server.jobs.local import PrepareJobRegistry
from phylo_lens_server.main import create_app
from phylo_lens_server.pipeline import layout
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService

CONTRACTS = json.loads(
    (Path(__file__).parent / "fixtures" / "server_contracts.json").read_text()
)["cases"]


@pytest.mark.parametrize(
    "case", CONTRACTS, ids=lambda case: case["request"]["dataset_name"]
)
def test_original_http_contracts(case, tmp_path, monkeypatch):
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 3))
            for i, node in enumerate(sorted(dataset.nodes, key=lambda node: node.id))
        },
    )
    store = SQLiteLayoutRepository(tmp_path)
    registry = PrepareJobRegistry(PrepareExecutor(PreparationService(store)))
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    app.dependency_overrides[get_prepare_job_registry] = lambda: registry
    try:
        with TestClient(app) as client:
            submitted = client.post("/api/graph/prepare", json=case["request"])
            assert submitted.status_code == 202
            job = submitted.json()
            job_id = job["job_id"]
            job["job_id"] = "<job>"
            assert job == case["job"]
            deadline = time.monotonic() + 5
            while True:
                status = client.get("/api/graph/prepare/" + job_id).json()
                if status["status"] != "pending" or time.monotonic() >= deadline:
                    break
                time.sleep(0.005)
            status["job_id"] = "<job>"
            assert status == case["status"]
            base = {
                "dataset_id": case["request"]["dataset_name"],
                "layout_version": status["result"]["layout_version"],
            }
            for query in case["queries"]:
                response = client.post(
                    "/api/graph/" + query["path"], json={**base, **query["payload"]}
                )
                assert response.status_code == 200
                assert response.json() == query["response"]
            response = client.put(
                "/api/graph/ancillary", json={**base, "ancillary_data": case["upload"]}
            )
            assert response.status_code == 200
            assert response.json() == case["replacement"]
            response = client.post(
                "/api/graph/viewport",
                json={**base, "layout_version": response.json()["layout_version"]},
            )
            assert response.json() == case["after"]
    finally:
        registry.shutdown()
