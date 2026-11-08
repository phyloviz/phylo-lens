from math import inf, nan

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import GOEBURST_ROOTING_STRATEGY, SourceFormat
from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.main import create_app
from phylo_lens_server.pipeline import layout
from phylo_lens_server.pipeline.distance_cutoff import cut_dataset
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService


def source(cutoff=None):
    return ingest_dataset(
        NormalizeRequest(
            format="newick",
            content="((a:0,b:2.5)branch:3,c:1)root; isolated;",
            ancillary_by_node_id={"a": {"country": "PT"}},
            distance_cutoff=cutoff,
        ).to_domain()
    ).dataset


def test_cut_preserves_nodes_metadata_and_orientation_with_inclusive_boundary():
    original = source()
    cut = cut_dataset(original, 2.5)
    assert {node.id for node in cut.nodes} == {node.id for node in original.nodes}
    assert {(edge.source, edge.target, edge.distance) for edge in cut.edges} == {
        ("branch", "a", 0),
        ("branch", "b", 2.5),
        ("root", "c", 1),
    }
    assert set(cut.technical_roots) == {"root", "branch", "isolated"}
    assert cut.annotations_by_node_id == original.annotations_by_node_id
    assert cut.annotations_by_node_id["a"].ancillary_data["country"] == "PT"
    assert len(original.edges) == 4
    assert layout_version_for_dataset(cut) != layout_version_for_dataset(original)
    assert layout_version_for_dataset(
        cut_dataset(original, 100)
    ) != layout_version_for_dataset(original)
    assert cut_dataset(original, None) is original


def test_zero_cutoff_keeps_zero_edges_and_singletons():
    cut = cut_dataset(source(), 0)
    assert [(edge.source, edge.target) for edge in cut.edges] == [("branch", "a")]
    assert len(cut.technical_roots) == len(cut.nodes) - 1


@pytest.mark.parametrize("cutoff", [-1, inf, nan, True])
def test_invalid_cutoffs_are_rejected(cutoff):
    with pytest.raises(ValueError, match="finite nonnegative"):
        cut_dataset(source(), cutoff)


def test_missing_distance_is_not_treated_as_zero():
    dataset = ingest_dataset(
        NormalizeRequest(format="newick", content="(a:1,b)root;").to_domain()
    ).dataset
    with pytest.raises(ValueError, match="every tree edge"):
        cut_dataset(dataset, 2)


def test_cutting_a_typing_tree_can_create_multiple_components():
    dataset = ingest_dataset(
        NormalizeRequest(format="newick", content="(a:1,b:2)root;").to_domain()
    ).dataset
    typing = dataset.model_copy(
        update={
            "source": dataset.source.model_copy(
                update={
                    "format": SourceFormat.TYPING_DATA,
                    "rooting_strategy": GOEBURST_ROOTING_STRATEGY,
                }
            )
        }
    )
    cut = cut_dataset(typing, 1)
    # Re-validation must accept an explicitly cut typing forest, while ordinary
    # goeBURST preparation continues to require one connected tree.
    validated = type(cut).model_validate(cut.model_dump())
    assert set(validated.technical_roots) == {"root", "b"}


def test_cut_components_survive_persistence_and_all_detail_tiers(tmp_path, monkeypatch):
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 3)) for i, node in enumerate(dataset.nodes)
        },
    )
    store = SQLiteLayoutRepository(tmp_path)
    service = PreparationService(store)
    content = "(((a:0,b:2.5)twig:1,c:1)branch:3,d:1)root; isolated;"
    original = ingest_dataset(
        NormalizeRequest(format="newick", content=content).to_domain()
    ).dataset
    policy = LodOptions(small_component_threshold=0)
    before = service.prepare_dataset(original, lod_options=policy)
    cut = ingest_dataset(
        NormalizeRequest(
            format="newick", content=content, distance_cutoff=2.5
        ).to_domain()
    ).dataset
    prepared = service.prepare_dataset(cut, lod_options=policy)
    assert len({cluster.lod_level for cluster in prepared.artifacts.clusters}) > 1
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    base = {
        "dataset_id": cut.dataset_id,
        "layout_version": prepared.artifacts.layout_version,
    }
    with TestClient(app) as client:
        components = client.post("/api/graph/components", json=base).json()[
            "components"
        ]
        assert sorted(item["node_count"] for item in components) == [1, 2, 5]
        for tier in {cluster.lod_level for cluster in prepared.artifacts.clusters}:
            result = client.post(
                "/api/graph/viewport", json={**base, "lod_level": tier}
            )
            assert result.status_code == 200, result.text
            data = result.json()
            owner = {
                node["id"]: node["tree_index"]["component_id"] for node in data["nodes"]
            }
            assert all(
                owner[edge["source"]] == owner[edge["target"]] for edge in data["edges"]
            )
        restored = client.post(
            "/api/graph/components",
            json={**base, "layout_version": before.artifacts.layout_version},
        )
        assert sorted(item["node_count"] for item in restored.json()["components"]) == [
            1,
            7,
        ]
