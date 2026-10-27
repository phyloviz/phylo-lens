import json
import sqlite3
from collections import Counter
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.main import create_app
from phylo_lens_server.pipeline import layout
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.layout import metadata_reader
from phylo_lens_server.repository.layout.components import component_source
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService


@pytest.fixture
def forest(tmp_path, monkeypatch):
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 3)) for i, node in enumerate(dataset.nodes)
        },
    )
    store = SQLiteLayoutRepository(tmp_path)
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="forest-panels",
            content="((a:1,b:2)branch:1,c:1)root; (d:1,e:1)other; isolated;",
        ).to_domain()
    ).dataset
    prepared = PreparationService(store).prepare_dataset(dataset)
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    with TestClient(app) as client:
        yield (
            client,
            store,
            {
                "dataset_id": dataset.dataset_id,
                "layout_version": prepared.artifacts.layout_version,
            },
        )


def test_component_pages_scope_every_read_before_limits(forest):
    client, _, base = forest
    first = client.post("/api/graph/components", json={**base, "limit": 1}).json()
    assert len(first["components"]) == 1
    assert first["next_cursor"] is not None
    rest = client.post(
        "/api/graph/components", json={**base, "after": first["next_cursor"]}
    ).json()
    components = first["components"] + rest["components"]
    assert {item["component_id"]: item["node_count"] for item in components} == {
        "root": 5,
        "other": 3,
        "isolated": 1,
    }
    assert rest["next_cursor"] is None
    assert {item["component_id"] for item in first["components"]}.isdisjoint(
        item["component_id"] for item in rest["components"]
    )
    scoped = {**base, "component_id": "other"}
    for level in [0, 1, 2, None]:
        response = client.post(
            "/api/graph/viewport", json={**scoped, "lod_level": level, "max_nodes": 2}
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total_node_count"] == 3
        assert 2 <= len(data["nodes"]) <= 3
        assert {n["tree_index"]["component_id"] for n in data["nodes"]} == {"other"}
        assert {n["id"] for n in data["nodes"]} <= {"other", "d", "e"}
        expected = next(item for item in components if item["component_id"] == "other")
        assert data["global_bounds"] == {
            key: expected[key] for key in ["min_x", "max_x", "min_y", "max_y"]
        }
    adaptive = client.post(
        "/api/graph/viewport",
        json={**scoped, "lod_level": 2, "lod_target_representations": 100},
    )
    assert adaptive.status_code == 200, adaptive.text
    assert len(adaptive.json()["nodes"]) == 3
    region = client.post(
        "/api/graph/region",
        json={
            **scoped,
            "xmin": -100,
            "xmax": 100,
            "ymin": -100,
            "ymax": 100,
            "max_nodes": 1,
        },
    )
    assert region.status_code == 200, region.text
    assert region.json()["total_node_count"] == 3
    assert region.json()["nodes"][0]["tree_index"]["component_id"] == "other"
    search = client.post("/api/graph/search", json={**scoped, "query": "branch"})
    assert search.status_code == 200, search.text
    assert search.json()["matches"] == []
    search = client.post("/api/graph/search", json={**scoped, "query": "d"})
    assert {match["node_id"] for match in search.json()["matches"]} == {"d"}
    outside = client.post("/api/graph/viewport", json=base).json()["nodes"]
    cluster = next(node["cluster_id"] for node in outside if node["id"] == "branch")
    assert (
        client.post(
            "/api/graph/viewport", json={**scoped, "cluster_id": cluster}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/graph/viewport", json={**base, "component_id": "missing"}
        ).status_code
        == 404
    )


def test_component_geometry_survives_ancillary_revisions_and_is_removed_with_layout(
    forest,
):
    client, store, base = forest
    original = client.post("/api/graph/components", json=base).json()
    revision = client.put(
        "/api/graph/ancillary",
        json={
            **base,
            "ancillary_data": {
                "format": "csv",
                "content": "id,country\nd,Portugal\n",
                "join_column": "id",
            },
        },
    )
    assert revision.status_code == 200, revision.text
    updated = {**base, "layout_version": revision.json()["layout_version"]}
    assert (
        client.post("/api/graph/components", json=updated).json()["components"]
        == original["components"]
    )
    assert (
        client.post(
            "/api/graph/search",
            json={**updated, "component_id": "root", "query": "Portugal"},
        ).json()["matches"]
        == []
    )
    assert (
        client.post(
            "/api/graph/search",
            json={**updated, "component_id": "other", "query": "Portugal"},
        ).json()["matches"][0]["node_id"]
        == "d"
    )
    store.clear_layout_version(base["dataset_id"], base["layout_version"])
    assert client.post("/api/graph/components", json=base).status_code == 404
    assert client.post("/api/graph/components", json=updated).status_code == 200


def test_component_queries_use_membership_and_page_indexes(forest):
    _, store, base = forest
    source, params = component_source("node_positions", "other")
    with sqlite3.connect(store.path) as connection:
        plan = connection.execute(
            f"explain query plan select node_id from {source} where dataset_id = ? and layout_version = ?",
            (*params, base["dataset_id"], base["layout_version"]),
        ).fetchall()
        assert any("node_tree_component_idx" in row[3] for row in plan), plan
        assert not any("SCAN src" in row[3] for row in plan), plan
        page_plan = connection.execute(
            "explain query plan select component_id from forest_components where dataset_id = ? and layout_version = ? and dfs_start > ? order by dfs_start limit 51",
            (base["dataset_id"], base["layout_version"], -1),
        ).fetchall()
        assert any("forest_components_page_idx" in row[3] for row in page_plan), (
            page_plan
        )
    for payload in [{"dataset_id": "missing"}, {**base, "layout_version": "missing"}]:
        assert forest[0].post("/api/graph/components", json=payload).status_code == 404


def test_coarse_clusters_and_adaptive_counts_remain_in_one_component(
    tmp_path, monkeypatch
):
    from phylo_lens_server.domain.lod import LodOptions

    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 5)) for i, node in enumerate(dataset.nodes)
        },
    )

    def chain(prefix):
        value = f"{prefix}99"
        for i in range(98, -1, -1):
            value = f"({value}:1){prefix}{i}"
        return value + ";"

    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="coarse-components",
            content=chain("a") + chain("b"),
        ).to_domain()
    ).dataset
    store = SQLiteLayoutRepository(tmp_path)
    prepared = PreparationService(store).prepare_dataset(
        dataset, lod_options=LodOptions(small_component_threshold=0)
    )
    base = {
        "dataset_id": dataset.dataset_id,
        "layout_version": prepared.artifacts.layout_version,
        "xmin": None,
        "xmax": None,
        "ymin": None,
        "ymax": None,
    }
    levels = max(cluster.lod_level for cluster in prepared.artifacts.clusters) + 1
    assert levels > 1
    for level in range(levels):
        whole = store.read_viewport(**base, lod_level=level)
        a = store.read_viewport(**base, lod_level=level, component_id="a0")
        b = store.read_viewport(**base, lod_level=level, component_id="b0")
        assert {n.node_id for n in a.nodes}.isdisjoint(n.node_id for n in b.nodes)
        assert {n.node_id for n in whole.nodes} == {
            n.node_id for n in (*a.nodes, *b.nodes)
        }
        assert all(n.tree_index.component_id == "a0" for n in a.nodes)
    a_counts = store.viewport_representation_counts(**base, component_id="a0")
    b_counts = store.viewport_representation_counts(**base, component_id="b0")
    assert a_counts == b_counts
    assert a_counts[max(a_counts)] == 100
    assert a_counts[min(a_counts)] < 100
    with sqlite3.connect(store.path) as connection:
        source, params = component_source(
            "prepared_clusters", "a0", node_column="representative_node_id"
        )
        plan = connection.execute(
            f"explain query plan select cluster_id from {source} where dataset_id = ? and layout_version = ?",
            (*params, dataset.dataset_id, prepared.artifacts.layout_version),
        ).fetchall()
        assert any("node_tree_component_idx" in row[3] for row in plan), plan
        assert any("prepared_clusters_representative_idx" in row[3] for row in plan), (
            plan
        )


def test_viewport_reuses_only_known_annotations_without_loading_them_again(forest):
    client, _, base = forest
    first = client.post("/api/graph/viewport", json=base).json()
    keys = [
        {
            "node_id": node["id"],
            "cluster_id": node["cluster_id"],
            "is_representative": node["is_representative"],
        }
        for node in first["nodes"]
    ]
    with patch.object(
        metadata_reader,
        "load_cluster_distributions",
        side_effect=AssertionError("Annotations loaded twice"),
    ):
        repeated = client.post(
            "/api/graph/viewport", json={**base, "known_annotations": keys}
        ).json()
    for original, cached in zip(first["nodes"], repeated["nodes"], strict=True):
        assert cached.pop("annotations_cached") is True
        assert not cached["ancillary_distribution"]
        assert not cached["isolates"]
        assert "metadata" not in cached and "tree_index" not in cached
        for field in ("metadata", "tree_index", "isolates", "ancillary_distribution"):
            if field in original:
                cached[field] = original[field]
        assert cached == original
    assert repeated["edges"] == first["edges"]
    wrong_identity = {**keys[0], "is_representative": not keys[0]["is_representative"]}
    fresh = client.post(
        "/api/graph/viewport", json={**base, "known_annotations": [wrong_identity]}
    ).json()
    assert all("annotations_cached" not in node for node in fresh["nodes"])
    unpinned = {"dataset_id": base["dataset_id"], "known_annotations": keys}
    assert client.post("/api/graph/viewport", json=unpinned).status_code == 422


def test_compressed_viewport_preserves_annotation_values_and_counts(forest):
    client, _, base = forest
    revision = client.put(
        "/api/graph/ancillary",
        json={
            **base,
            "ancillary_data": {
                "content": "id,country\na," + "Portugal" * 1000 + "\nb,Spain\n",
                "join_column": "id",
            },
        },
    )
    assert revision.status_code == 200, revision.text
    query = {**base, "layout_version": revision.json()["layout_version"]}
    plain = client.post(
        "/api/graph/viewport", json=query, headers={"Accept-Encoding": "identity"}
    )
    compressed = client.post(
        "/api/graph/viewport", json=query, headers={"Accept-Encoding": "gzip"}
    )
    assert compressed.headers["Content-Encoding"] == "gzip"
    assert int(compressed.headers["Content-Length"]) < len(plain.content) / 5
    assert compressed.json() == plain.json()
    assert any(
        node.get("metadata", {}).get("country") == "Portugal" * 1000
        for node in plain.json()["nodes"]
    )


def test_observation_values_reuse_across_tiers_preserves_joint_category_counts(forest):
    from phylo_lens_server.domain.lod import LodOptions

    client, store, _ = forest
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="observation-reuse",
            content="(((a:1,b:1)x:1,(c:1,d:1)y:1)z:1,e:1)root;",
            metadata_schema=[
                {"key": "country", "type": "string"},
                {"key": "year", "type": "number"},
            ],
            metadata_by_node_id={
                "a": {"country": "PT", "year": 2020},
                "b": {"country": "PT", "year": 2021},
                "c": {"country": "ES", "year": 2020},
            },
        ).to_domain()
    ).dataset
    prepared = PreparationService(store).prepare_dataset(
        dataset, lod_options=LodOptions(small_component_threshold=0)
    )
    base = {
        "dataset_id": dataset.dataset_id,
        "layout_version": prepared.artifacts.layout_version,
    }
    levels = sorted({cluster.lod_level for cluster in prepared.artifacts.clusters})
    assert len(levels) > 1
    known = {}
    reused_count = 0
    for level in levels + list(reversed(levels)):
        query = {**base, "lod_level": level}
        original = client.post("/api/graph/viewport", json=query).json()
        compact = client.post(
            "/api/graph/viewport", json={**query, "known_observations": list(known)}
        ).json()
        assert compact["edges"] == original["edges"]
        next_known = {}
        for expected, node in zip(original["nodes"], compact["nodes"], strict=True):
            assert node["id"] == expected["id"]
            for observation in node["ancillary_distribution"]:
                reference = observation["reference_id"]
                if observation.get("values_cached"):
                    reused_count += 1
                    observation["values"] = known[reference]
                next_known[reference] = observation["values"]

            def histogram(observations):
                counts = Counter()
                for observation in observations:
                    counts[json.dumps(observation["values"], sort_keys=True)] += (
                        observation["count"]
                    )
                return counts

            assert histogram(node["ancillary_distribution"]) == histogram(
                expected["ancillary_distribution"]
            )
        known = next_known
    assert reused_count > 0
