from itertools import combinations
from random import Random

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.data.distance_connections import allelic_pairs, patristic_pairs
from phylo_lens_server.domain.connections import ConnectionContext
from phylo_lens_server.domain.models import GraphEdge
from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.main import create_app
from phylo_lens_server.pipeline import layout
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService


def path_oracle(nodes, edges, threshold):
    neighbors = {node: [] for node in nodes}
    for edge in edges:
        neighbors[edge.source].append((edge.target, edge.distance))
        neighbors[edge.target].append((edge.source, edge.distance))
    result = set()
    for source in nodes:
        stack = [(source, None, 0)]
        while stack:
            node, parent, distance = stack.pop()
            if source < node and distance <= threshold:
                result.add((source, node, distance))
            stack.extend(
                (other, node, distance + weight)
                for other, weight in neighbors[node]
                if other != parent
            )
    return result


@pytest.mark.parametrize("threshold", [0, 0.5, 2.5, 100])
def test_centroid_pairs_match_independent_tree_path_traversal(threshold):
    rng = Random(714)
    for count in [1, 2, 7, 31, 65]:
        ids = [f"n{i:03}" for i in range(count)]
        edges = tuple(
            GraphEdge(
                id=str(i),
                source=ids[rng.randrange(i)],
                target=ids[i],
                distance=rng.choice([0, 0.5, 1, 2.5]),
            )
            for i in range(1, count)
        )
        context = ConnectionContext(dict.fromkeys(ids, ids[0]), edges)
        pairs = list(patristic_pairs(context, frozenset(ids), threshold))
        assert len(pairs) == len(set(pairs))
        assert set(pairs) == path_oracle(ids, edges, threshold)


def test_radius_index_handles_deep_forests_and_named_nodes_without_recursion():
    ids = [f"n{i}" for i in range(6000)]
    edges = tuple(
        GraphEdge(id=str(i), source=ids[i - 1], target=ids[i], distance=1)
        for i in range(1, len(ids))
    )
    context = ConnectionContext(
        {**dict.fromkeys(ids, ids[0]), "isolated": "isolated"}, edges
    )
    assert list(
        patristic_pairs(context, frozenset([ids[0], ids[-1], "isolated"]), 5999)
    ) == [("n0", "n5999", 5999)]


@pytest.mark.parametrize("threshold", [0, 1, 5, 20])
def test_allelic_block_candidates_match_full_hamming_with_component_scope(threshold):
    rng = Random(93)
    profiles = {
        str(i): tuple(str(rng.randrange(3)) for _ in range(20)) for i in range(35)
    }
    profiles["near"] = (*profiles["0"][:-1], "different")
    owners = {node: str(i % 2) for i, node in enumerate(profiles)}
    owners["near"] = owners["0"]
    expected = {
        (
            a,
            b,
            float(sum(x != y for x, y in zip(profiles[a], profiles[b], strict=True))),
        )
        for a, b in combinations(sorted(profiles), 2)
        if owners[a] == owners[b]
        and sum(x != y for x, y in zip(profiles[a], profiles[b], strict=True))
        <= threshold
    }
    assert set(allelic_pairs(profiles, threshold, owners)) == expected


@pytest.fixture
def prepared_connections(tmp_path, monkeypatch):
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 3)) for i, node in enumerate(dataset.nodes)
        },
    )
    store = SQLiteLayoutRepository(tmp_path)
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    with TestClient(app) as client:

        def prepare(content, cutoff=None):
            dataset = ingest_dataset(
                NormalizeRequest(
                    format="newick", content=content, distance_cutoff=cutoff
                ).to_domain()
            ).dataset
            result = PreparationService(store).prepare_dataset(dataset)
            return {
                "dataset_id": dataset.dataset_id,
                "layout_version": result.artifacts.layout_version,
                "format": "newick",
                "content": content,
            }

        yield client, prepare


def test_api_adds_exact_named_path_links_and_never_rejoins_cut_components(
    prepared_connections,
):
    client, prepare = prepared_connections
    base = prepare("((a:1,b:1):1,c:3)root;")
    result = client.post("/api/graph/connections", json={**base, "threshold": 2})
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["metric"] == "patristic"
    assert {(e["source"], e["target"], e["distance"]) for e in data["edges"]} == {
        ("a", "b", 2),
        ("a", "root", 2),
        ("b", "root", 2),
    }
    cut = prepare("((a:1,b:1):1,c:3)root;", 1)
    cut_result = client.post(
        "/api/graph/connections", json={**cut, "threshold": 100}
    ).json()
    assert all("c" not in (e["source"], e["target"]) for e in cut_result["edges"])
    assert all(
        "union" not in e["source"] and "union" not in e["target"]
        for e in cut_result["edges"]
    )


def test_api_reports_complete_failure_for_budget_missing_lengths_and_wrong_source(
    prepared_connections,
):
    client, prepare = prepared_connections
    base = prepare("((a:1,b:1):1,c:3)root;")
    limited = client.post(
        "/api/graph/connections", json={**base, "threshold": 100, "max_connections": 1}
    )
    assert limited.status_code == 422
    assert "No partial overlay" in limited.json()["detail"]
    assert "edges" not in limited.json()
    wrong = client.post(
        "/api/graph/connections",
        json={**base, "content": "(x:1,y:1)r;", "threshold": 2},
    )
    assert wrong.status_code == 422
    unknown = prepare("(a,b)root;")
    missing = client.post("/api/graph/connections", json={**unknown, "threshold": 2})
    assert missing.status_code == 422
    assert "known" in missing.json()["detail"]


def test_zero_length_paths_are_valid_connections(prepared_connections):
    client, prepare = prepared_connections
    base = prepare("(a:0,b:0);")
    result = client.post("/api/graph/connections", json={**base, "threshold": 0})
    assert result.status_code == 200
    assert [
        (e["source"], e["target"], e["distance"]) for e in result.json()["edges"]
    ] == [("a", "b", 0)]


def test_allelic_query_uses_retained_loci_and_groups_equivalent_profiles(
    tmp_path, monkeypatch
):
    from pathlib import Path

    from phylo_lens_server.domain.models import (
        GOEBURST_ROOTING_STRATEGY,
        Dataset,
        DatasetSource,
        GraphNode,
        SourceFormat,
    )

    content = (
        Path(__file__).resolve().parents[3] / "examples/typing/missing-loci.tsv"
    ).read_text()
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), 0.0) for i, node in enumerate(dataset.nodes)
        },
    )
    # The known fixture MST isolates the new query from the already-tested Java conversion.
    dataset = Dataset(
        dataset_id="typing",
        nodes=tuple(GraphNode(id=node) for node in ["iso_a", "iso_c", "iso_d"]),
        edges=(
            GraphEdge(id="ac", source="iso_a", target="iso_c", distance=1),
            GraphEdge(id="cd", source="iso_c", target="iso_d", distance=1),
        ),
        technical_roots=("iso_c",),
        source=DatasetSource(
            format=SourceFormat.TYPING_DATA,
            generated_at="fixture",
            rooting_strategy=GOEBURST_ROOTING_STRATEGY,
        ),
    )
    store = SQLiteLayoutRepository(tmp_path)
    result = PreparationService(store).prepare_dataset(dataset)
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    query = {
        "dataset_id": dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        "format": "typing_data",
        "content": content,
        "threshold": 2,
    }
    with TestClient(app) as client:
        response = client.post("/api/graph/connections", json=query)
        assert response.status_code == 200, response.text
        assert response.json()["metric"] == "allelic"
        assert [
            (edge["source"], edge["target"], edge["distance"])
            for edge in response.json()["edges"]
        ] == [("iso_a", "iso_d", 2)]
        assert (
            client.post(
                "/api/graph/connections", json={**query, "threshold": 1}
            ).json()["edges"]
            == []
        )
        assert (
            client.post(
                "/api/graph/connections", json={**query, "threshold": 1.5}
            ).status_code
            == 422
        )


def test_decimal_path_equality_is_not_lost_to_binary_roundoff(prepared_connections):
    client, prepare = prepared_connections
    base = prepare("(a:0.1,b:0.2);")
    result = client.post("/api/graph/connections", json={**base, "threshold": 0.3})
    assert result.status_code == 200
    assert [
        (e["source"], e["target"], e["distance"]) for e in result.json()["edges"]
    ] == [("a", "b", 0.3)]
    mixed = prepare("(a:0.05,(b:0.05)middle:1e-30);")
    result = client.post("/api/graph/connections", json={**mixed, "threshold": 0.1})
    assert result.status_code == 200
    pairs = {(edge["source"], edge["target"]) for edge in result.json()["edges"]}
    assert ("a", "middle") in pairs
    assert ("a", "b") not in pairs
