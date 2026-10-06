from phylo_lens_server.domain.views import ViewportQuery

"""Unbounded normal reads and explicit caller-controlled limits."""

import pytest
from pydantic import ValidationError

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.preparation import ClusterLayout, NodeLayoutPosition
from phylo_lens_server.domain.views import LayoutBounds
from phylo_lens_server.http.graph.schemas import (
    GraphRegionQuery,
    GraphViewportQuery,
    NormalizeRequest,
)
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    compute_prepared_edges,
    prepare_layout_artifacts,
)
from phylo_lens_server.repository.layout import viewport_reader as reader
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)


@pytest.fixture(scope="module")
def large_prepared_tree(tmp_path_factory):
    # Count-limit regression only: a cheap positioned tree avoids Graphviz cost.
    content = "(" + ",".join(f"(leaf{i})branch{i}" for i in range(10001)) + ")root;"
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick", dataset_name="unbounded", content=content
        ).to_domain()
    ).dataset
    artifacts = prepare_layout_artifacts(dataset)
    store = SQLiteLayoutRepository(tmp_path_factory.mktemp("unbounded"))
    store.save_artifacts(artifacts)
    index = {n.id: i for i, n in enumerate(dataset.nodes)}
    finest = max(c.lod_level for c in artifacts.clusters)
    positions = tuple(
        NodeLayoutPosition(
            dataset.dataset_id,
            artifacts.layout_version,
            c.cluster_id,
            c.representative_node_id,
            float(index[c.representative_node_id]),
            0,
            "ready",
        )
        for c in artifacts.clusters
        if c.lod_level == finest
    )
    layouts = tuple(
        ClusterLayout(
            dataset.dataset_id,
            artifacts.layout_version,
            c.cluster_id,
            c.representative_node_id,
            c.member_count,
            float(index[c.representative_node_id]),
            0,
            1,
            LayoutBounds(
                min(index[n] for n in c.member_node_ids),
                max(index[n] for n in c.member_node_ids),
                0,
                0,
            ),
            "ready",
        )
        for c in artifacts.clusters
    )
    store.save_layouts(layouts, positions)
    store.save_prepared_edges(compute_prepared_edges(artifacts))
    return store, artifacts


def query_args(artifacts):
    return {
        "dataset_id": artifacts.dataset.dataset_id,
        "layout_version": artifacts.layout_version,
        "xmin": None,
        "xmax": None,
        "ymin": None,
        "ymax": None,
    }


@pytest.mark.parametrize("level, expected", [(0, 10002), (1, 20003)])
def test_unbounded_viewport_exceeds_former_limits(large_prepared_tree, level, expected):
    store, artifacts = large_prepared_tree
    result = store.read_viewport(**query_args(artifacts), lod_level=level)
    assert len(result.nodes) == expected
    assert result.total_node_count == expected
    assert not result.truncated
    ids = {node.node_id for node in result.nodes}
    assert all(e.source in ids and e.target in ids for e in result.edges)


def test_bounds_and_explicit_limit_still_work(large_prepared_tree):
    store, artifacts = large_prepared_tree
    bounded = store.read_viewport(**query_args(artifacts), lod_level=0, max_nodes=7)
    assert len(bounded.nodes) == 7
    assert bounded.total_node_count == 10002
    assert bounded.truncated
    args = query_args(artifacts) | {"xmin": 0, "xmax": 20003, "ymin": -1, "ymax": 1}
    region = store.read_region(**args)
    assert len(region.nodes) == 20003
    assert not region.truncated
    bounded_region = store.read_region(**args, max_nodes=5)
    assert len(bounded_region.nodes) == 5
    assert bounded_region.truncated
    cropped = store.read_region(**(args | {"xmax": 9}))
    assert len(cropped.nodes) == 10
    assert not cropped.truncated


def test_unbounded_expansion_and_neighbor_does_not_mask_truncation(large_prepared_tree):
    store, artifacts = large_prepared_tree
    cluster = next(c for c in artifacts.clusters if c.member_count == 2)
    expanded = store.read_viewport(
        **query_args(artifacts), cluster_id=cluster.cluster_id
    )
    assert len([n for n in expanded.nodes if not n.is_representative]) == 2
    assert not expanded.truncated
    limited = store.read_viewport(
        **query_args(artifacts),
        cluster_id=cluster.cluster_id,
        focus_node_id=cluster.representative_node_id,
        max_nodes=1,
    )
    assert len(limited.nodes) == 2  # one member plus an attachment neighbor
    assert limited.total_node_count == 2
    assert limited.truncated


@pytest.mark.parametrize("model", [GraphViewportQuery, GraphRegionQuery])
def test_optional_api_budget_without_hard_upper_bound(model):
    args = {"dataset_id": "x", "xmin": 0, "xmax": 1, "ymin": 0, "ymax": 1}
    assert model(**args).max_nodes is None
    assert model(**args, max_nodes=None).max_nodes is None
    assert model(**args, max_nodes=100000).max_nodes == 100000
    with pytest.raises(ValidationError):
        model(**args, max_nodes=0)


class RecordingConnection:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        return self

    def fetchone(self):
        return {"total_count": 0}

    def fetchall(self):
        return []


@pytest.mark.parametrize("limit", [None, 7])
def test_postgres_sql_limits_are_only_explicit(limit):
    raw = RecordingConnection()
    conn = LayoutSQL(raw, "postgres")
    args = {"dataset_id": "x", "layout_version": "v", "max_nodes": limit}
    bounds = {"xmin": None, "xmax": None, "ymin": None, "ymax": None}
    reader.read_positioned_nodes(conn, **args, **bounds)
    reader._read_cluster_member_nodes(conn, **args, cluster_id="c")
    reader._read_cluster_representatives(conn, **args, **bounds, cluster_level=0)
    reader._read_node_positions_by_ids(conn, **args, node_ids={"a"})
    for sql, params in raw.calls:
        assert "{limit_clause}" not in sql
        if "count(*)" not in sql:
            assert ("limit %s" in sql) == (limit is not None)
            assert sql.count("%s") == len(params)


def test_adaptive_selection_counts_the_complete_detail_boundary_fan(
    large_prepared_tree,
):
    from phylo_lens_server.services.graph_reads import read_graph_viewport

    store, artifacts = large_prepared_tree
    root = next(
        n
        for n in store.read_viewport(**query_args(artifacts), lod_level=1).nodes
        if n.node_id == "root"
    )
    args = query_args(artifacts) | {
        "xmin": root.x - 1e-7,
        "xmax": root.x + 1e-7,
        "ymin": -1e-7,
        "ymax": 1e-7,
    }
    counts = store.viewport_representation_counts(**args)
    assert counts == {0: 1, 1: 10002}
    response = read_graph_viewport(
        ViewportQuery(**args, lod_level=1, lod_target_representations=1), store
    )
    assert response.lod_level == 0
    assert [n.node_id for n in response.nodes] == ["root"]
    assert not response.truncated
