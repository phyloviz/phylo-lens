from phylo_lens_server.domain.views import ViewportQuery

"""Viewport selection uses complete prepared tiers, never arbitrary subsets."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from phylo_lens_server.database.sqlite import connect
from phylo_lens_server.domain.views import select_viewport_lod_level
from phylo_lens_server.http.graph.schemas import GraphViewportQuery, NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.layout.lod_reader import (
    read_viewport_representation_counts,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.graph_reads import read_graph_viewport
from phylo_lens_server.services.preparation import PreparationService


def test_semantic_zoom_is_preference_and_spare_capacity_refines_early():
    assert select_viewport_lod_level({0: 3, 1: 7, 2: 15}, 2, 10) == 1
    assert select_viewport_lod_level({0: 1, 1: 2, 2: 3}, 2, 10) == 2
    assert select_viewport_lod_level({0: 1, 1: 2, 2: 3}, 1, 10) == 2


def test_nonmonotonic_spatial_counts_and_empty_regions():
    assert select_viewport_lod_level({0: 2, 1: 20, 2: 4}, 2, 5) == 2
    assert select_viewport_lod_level({0: 0, 1: 0, 2: 0}, 2, 5) == 2
    assert select_viewport_lod_level({}, 2, 5) == 2


def test_unavoidable_complexity_keeps_coarsest_complete():
    assert select_viewport_lod_level({0: 100, 1: 200}, 1, 5) == 0
    with pytest.raises(ValueError):
        select_viewport_lod_level({0: 1}, 0, 0)


def test_density_hysteresis_and_zoom_out():
    assert select_viewport_lod_level({0: 30, 1: 95}, 1, 100, 0) == 0
    assert select_viewport_lod_level({0: 30, 1: 80}, 1, 100, 0) == 1
    assert select_viewport_lod_level({0: 30, 1: 110}, 1, 100, 1) == 1
    assert select_viewport_lod_level({0: 30, 1: 120}, 1, 100, 1) == 0
    assert select_viewport_lod_level({0: 30, 1: 80}, 0, 100, 1) == 0


@pytest.fixture(scope="module")
def real_prepared(tmp_path_factory):
    fixture = (
        Path(__file__).resolve().parents[3] / "examples/newick/phyloviz-spneumoniae.nwk"
    )
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick", dataset_name="viewport-real", content=fixture.read_text()
        ).to_domain()
    ).dataset
    store = SQLiteLayoutRepository(tmp_path_factory.mktemp("viewport-real"))
    result = PreparationService(store).prepare_dataset(dataset)
    return store, result


def test_real_regions_choose_different_effective_levels_at_same_zoom(real_prepared):
    store, result = real_prepared
    positions = result.node_positions
    common = {
        "dataset_id": result.artifacts.dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        "lod_level": 4,
        "zoom": 25.79,
        "lod_target_representations": 20,
    }
    dense_bounds = {
        "xmin": min(p.x for p in positions) - 1,
        "xmax": max(p.x for p in positions) + 1,
        "ymin": min(p.y for p in positions) - 1,
        "ymax": max(p.y for p in positions) + 1,
    }
    dense = read_graph_viewport(ViewportQuery(**common, **dense_bounds), store)
    assert dense.lod_level == 2
    assert len(dense.nodes) == 15
    leaf_ids = {node.id for node in result.artifacts.dataset.nodes} - {
        e.source for e in result.artifacts.dataset.edges
    }
    leaf = next(p for p in positions if p.node_id in leaf_ids)
    sparse_bounds = {
        "xmin": leaf.x - 1e-7,
        "xmax": leaf.x + 1e-7,
        "ymin": leaf.y - 1e-7,
        "ymax": leaf.y + 1e-7,
    }
    sparse = read_graph_viewport(ViewportQuery(**common, **sparse_bounds), store)
    assert sparse.lod_level == 7
    assert len(sparse.nodes) == 2  # leaf and its boundary neighbor
    assert not sparse.truncated and not dense.truncated
    assert all(n.member_count == 1 for n in sparse.nodes)
    ids = {n.node_id for n in sparse.nodes}
    assert all(e.source in ids and e.target in ids for e in sparse.edges)
    # Prefetch bounds do not determine the effective tier: use visible bounds.
    padded = read_graph_viewport(
        GraphViewportQuery(
            **common, **dense_bounds, lod_selection_bounds=sparse_bounds
        ),
        store,
    )
    assert padded.lod_level == 7
    assert len(padded.nodes) == 379  # no target-based truncation
    assert not padded.truncated


def test_real_count_union_includes_detail_boundary_neighbors(real_prepared):
    store, result = real_prepared
    position = result.node_positions[0]
    counts = store.viewport_representation_counts(
        dataset_id=result.artifacts.dataset.dataset_id,
        layout_version=result.artifacts.layout_version,
        xmin=position.x - 1e-7,
        xmax=position.x + 1e-7,
        ymin=position.y - 1e-7,
        ymax=position.y + 1e-7,
    )
    read = store.read_viewport(
        dataset_id=result.artifacts.dataset.dataset_id,
        layout_version=result.artifacts.layout_version,
        xmin=position.x - 1e-7,
        xmax=position.x + 1e-7,
        ymin=position.y - 1e-7,
        ymax=position.y + 1e-7,
        lod_level=7,
    )
    assert counts[7] == len(read.nodes)
    assert counts[7] > 1


def test_shared_sql_supports_postgres_placeholders(real_prepared):
    store, result = real_prepared
    args = {
        "dataset_id": result.artifacts.dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        "xmin": -1,
        "xmax": 1,
        "ymin": -1,
        "ymax": 1,
    }

    class PostgresParametersOnSQLite:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, sql, params):
            assert sql.count("%s") == len(params)
            return self.connection.execute(sql.replace("%s", "?"), params)

    with connect(store.path) as connection:
        expected = read_viewport_representation_counts(
            connection, **args, placeholder="?"
        )
        actual = read_viewport_representation_counts(
            PostgresParametersOnSQLite(connection), **args, placeholder="%s"
        )
    assert actual == expected


@pytest.mark.parametrize(
    "bounds",
    [
        {"xmin": 1, "xmax": 0, "ymin": 0, "ymax": 1},
        {"xmin": float("nan"), "xmax": 0, "ymin": 0, "ymax": 1},
    ],
)
def test_invalid_selection_bounds(bounds):
    with pytest.raises(ValidationError):
        GraphViewportQuery(dataset_id="x", lod_selection_bounds=bounds)


def test_explicit_expansion_bypasses_adaptive_selection(real_prepared):
    store, result = real_prepared
    cluster = next(c for c in result.artifacts.clusters if c.member_count > 1)
    response = read_graph_viewport(
        GraphViewportQuery(
            dataset_id=result.artifacts.dataset.dataset_id,
            layout_version=result.artifacts.layout_version,
            cluster_id=cluster.cluster_id,
            lod_target_representations=1,
        ),
        store,
    )
    members = [n for n in response.nodes if not n.is_representative]
    assert len(members) == cluster.member_count
    assert not response.truncated


def test_repository_optional_count_ceiling_remains_available(real_prepared):
    store, result = real_prepared
    counts = store.viewport_representation_counts(
        dataset_id=result.artifacts.dataset.dataset_id,
        layout_version=result.artifacts.layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_lod_level=2,
    )
    assert counts == {0: 3, 1: 7, 2: 15}


def test_early_refinement_requires_progressively_more_spare_capacity():
    # With identical visible counts, semantic zoom remains meaningful.
    counts = {0: 5, 1: 10, 2: 20, 3: 40}
    assert select_viewport_lod_level(counts, 0, 100) == 2
    assert select_viewport_lod_level(counts, 1, 100) == 2
    assert select_viewport_lod_level(counts, 2, 100) == 3
    # A few coarse markers hide a dense finer representation: keep it closed.
    assert select_viewport_lod_level({0: 2, 1: 900, 2: 1800}, 1, 100) == 0
    # Nonmonotonic counts also allow an early tier beyond a dense intermediate.
    assert select_viewport_lod_level({0: 2, 1: 900, 2: 4}, 0, 100) == 2


def test_early_refinement_hysteresis_uses_zoom_adjusted_target():
    assert select_viewport_lod_level({0: 2, 1: 40}, 0, 100, 0) == 1
    assert select_viewport_lod_level({0: 2, 1: 48}, 0, 100, 0) == 0
    assert select_viewport_lod_level({0: 2, 1: 55}, 0, 100, 1) == 1
    assert select_viewport_lod_level({0: 2, 1: 60}, 0, 100, 1) == 0


@pytest.mark.parametrize("bounded", [False, True])
def test_prospective_counts_match_actual_retrieval_at_every_tier(
    real_prepared, bounded
):
    store, result = real_prepared
    position = result.node_positions[0]
    bounds = (
        {
            "xmin": position.x - 1e-7,
            "xmax": position.x + 1e-7,
            "ymin": position.y - 1e-7,
            "ymax": position.y + 1e-7,
        }
        if bounded
        else {"xmin": None, "xmax": None, "ymin": None, "ymax": None}
    )
    args = {
        "dataset_id": result.artifacts.dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        **bounds,
    }
    counts = store.viewport_representation_counts(**args)
    for level, count in counts.items():
        response = store.read_viewport(**args, lod_level=level)
        assert count == len(response.nodes), level
        assert not response.truncated


def test_hysteresis_still_allows_comfortable_intermediate_refinement():
    assert select_viewport_lod_level({0: 10, 1: 40, 2: 95}, 2, 100, 0) == 1
    assert select_viewport_lod_level({0: 10, 1: 40, 2: 80}, 2, 100, 0) == 2
