import os
from collections import deque

import pytest
from fastapi.testclient import TestClient

from phylo_lens_server.data import phylolib
from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.revisions import AncillaryTable, AncillaryUpdate
from phylo_lens_server.domain.rooting import RootingUpdate
from phylo_lens_server.http.graph.dependencies import get_prepared_layout_store
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.main import create_app
from phylo_lens_server.pipeline import layout
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.ancillary import apply_ancillary_data
from phylo_lens_server.services.preparation import PreparationService
from phylo_lens_server.services.rooting import set_technical_root


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), float(i % 3)) for i, node in enumerate(dataset.nodes)
        },
    )
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            content="((C:1,D:2)B:3,E:4)A;(Y:1)X;",
            metadata_by_node_id={"c": {"country": "PT"}},
        ).to_domain()
    ).dataset
    store = SQLiteLayoutRepository(tmp_path)
    result = PreparationService(store).prepare_dataset(
        dataset, lod_options=LodOptions(small_component_threshold=0)
    )
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda *_: pytest.fail("Rerooting must reuse geometry"),
    )
    return SQLiteLayoutRepository(tmp_path), result


def test_reroot_after_restart_preserves_forest_geometry_and_metadata(prepared):
    store, original = prepared
    dataset = original.artifacts.dataset
    version = original.artifacts.layout_version
    result = set_technical_root(RootingUpdate(dataset.dataset_id, version, "b"), store)
    assert result.summary.technical_roots == ("b", "x")
    assert result.default_roots == ("a", "x")
    assert result.component_ids == {"a": "b", "x": "x"}
    assert result.summary.layout_version != version
    with store.rooting_revision(
        dataset.dataset_id, result.summary.layout_version
    ) as revision:
        changed = revision.source.dataset
        assert changed.nodes == dataset.nodes
        assert changed.edges == dataset.edges
        assert changed.annotations_by_node_id == dataset.annotations_by_node_id
        assert changed.ancillary_rows_by_node_id == dataset.ancillary_rows_by_node_id
        assert revision.source.lod_options.small_component_threshold == 0
    positions = lambda current: {
        p.node_id: (p.x, p.y)
        for p in store.load_node_positions(dataset.dataset_id, current)
    }
    assert positions(version) == positions(result.summary.layout_version)
    view = store.read_viewport(
        dataset_id=dataset.dataset_id,
        layout_version=result.summary.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        lod_level=999,
    )
    actual = {node.node_id: node.tree_index for node in view.nodes}
    # Independent breadth-first oracle from B, retaining X's orientation.
    neighbors = {node.id: [] for node in dataset.nodes}
    for edge in dataset.edges:
        neighbors[edge.source].append(edge.target)
        neighbors[edge.target].append(edge.source)
    for root in ("b", "x"):
        queue = deque([(root, None, 0)])
        while queue:
            node, parent, depth = queue.popleft()
            assert actual[node].depth == depth
            assert actual[node].parent_id == parent
            queue.extend(
                (child, node, depth + 1) for child in neighbors[node] if child != parent
            )
    # Source versions remain available and unchanged.
    with store.rooting_revision(dataset.dataset_id, version) as revision:
        assert revision.source.dataset.technical_roots == ("a", "x")
    restored = set_technical_root(
        RootingUpdate(dataset.dataset_id, result.summary.layout_version, None), store
    )
    assert restored.summary.technical_roots == ("a", "x")
    assert restored.summary.layout_version == version


def test_reroot_retains_replaced_ancillary_values_and_is_idempotent(prepared):
    store, original = prepared
    dataset = original.artifacts.dataset
    metadata = apply_ancillary_data(
        AncillaryUpdate(
            dataset.dataset_id,
            original.artifacts.layout_version,
            AncillaryTable("id,country\nc,ES\n", "id"),
        ),
        store,
    )
    changed = set_technical_root(
        RootingUpdate(dataset.dataset_id, metadata.layout_version, "b"), store
    )
    again = set_technical_root(
        RootingUpdate(dataset.dataset_id, metadata.layout_version, "b"), store
    )
    assert changed == again
    no_op = set_technical_root(
        RootingUpdate(dataset.dataset_id, changed.summary.layout_version, "b"), store
    )
    assert no_op.summary.layout_version == changed.summary.layout_version
    with store.rooting_revision(
        dataset.dataset_id, changed.summary.layout_version
    ) as revision:
        assert (
            revision.source.dataset.annotations_by_node_id["c"].ancillary_data
            | revision.source.dataset.annotations_by_node_id[
                "c"
            ].ancillary_summary.values
        )["country"] == "ES"


@pytest.mark.skipif(
    not os.environ.get(phylolib.ENV_PHYLOLIB_JAR),
    reason="Requires the pinned PhyloLib JAR",
)
@pytest.mark.parametrize(
    "options", [{"algorithm": "goeburstfullmst"}, {"algorithm": "goeburst", "nlv": 3}]
)
def test_typing_reroot_retains_isolates_options_and_distances(
    tmp_path, monkeypatch, options
):
    content = "ST\tL1\tL2\tL3\tL4\nA\t1\t1\t1\t1\nA2\t1\t1\t1\t1\nB\t1\t1\t1\t2\nC\t2\t2\t2\t2\nD\t3\t3\t3\t3\n"
    dataset = ingest_dataset(
        NormalizeRequest(
            format="typing_data",
            content=content,
            typing_options=options,
            ancillary_data={
                "content": "ID,country\nA,PT\nA2,ES\nB,FR\nC,DE\nD,IT\n",
                "join_column": "ID",
            },
        ).to_domain()
    ).dataset
    store = SQLiteLayoutRepository(tmp_path)
    prepared = PreparationService(store).prepare_dataset(dataset)

    def unexpected(*args, **kwargs):
        pytest.fail("Rerooting must not repeat inference or global layout")

    monkeypatch.setattr(phylolib, "_run_phylolib_cli", unexpected)
    monkeypatch.setattr(layout, "compute_global_node_positions", unexpected)
    rooted = set_technical_root(
        RootingUpdate(dataset.dataset_id, prepared.artifacts.layout_version, "a"), store
    )
    assert "a" in rooted.summary.technical_roots
    with store.rooting_revision(
        dataset.dataset_id, rooted.summary.layout_version
    ) as revision:
        changed = revision.source.dataset
        assert changed.nodes == dataset.nodes
        assert changed.edges == dataset.edges
        assert changed.isolates_by_node_id == dataset.isolates_by_node_id
        assert [isolate.id for isolate in changed.isolates_by_node_id["a"]] == [
            "A",
            "A2",
        ]
        assert changed.source.model_dump(
            exclude={"rooting_strategy"}
        ) == dataset.source.model_dump(exclude={"rooting_strategy"})


def test_root_endpoint_validates_identity_and_publishes_no_partial_revision(
    prepared, monkeypatch
):
    store, original = prepared
    app = create_app()
    app.dependency_overrides[get_prepared_layout_store] = lambda: store
    base = {
        "dataset_id": original.artifacts.dataset.dataset_id,
        "layout_version": original.artifacts.layout_version,
    }
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/graph/root", json={**base, "node_id": "missing"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/graph/root",
                json={**base, "layout_version": "missing", "node_id": "b"},
            ).status_code
            == 404
        )
        assert (
            client.post("/api/graph/root", json={**base, "node_id": ""}).status_code
            == 422
        )
        assert client.post("/api/graph/root", json=base).status_code == 422
        response = client.post("/api/graph/root", json={**base, "node_id": "b"})
        assert response.status_code == 200
        assert response.json()["technical_roots"] == ["b", "x"]
    from phylo_lens_server.repository.layout import writer

    def failed_write(*args, **kwargs):
        raise RuntimeError("write failed")

    monkeypatch.setattr(writer, "save_layouts", failed_write)
    with pytest.raises(RuntimeError, match="write failed"):
        set_technical_root(
            RootingUpdate(base["dataset_id"], base["layout_version"], "c"), store
        )
    # The successful revision is still the latest published snapshot.
    assert (
        store.latest_layout_version(base["dataset_id"])
        == response.json()["layout_version"]
    )
