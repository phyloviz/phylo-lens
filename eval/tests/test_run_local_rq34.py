"""Local structural evidence must detect corrupt persisted partitions/edges."""

import sqlite3

import pytest
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.pipeline.clustering import (
    rooted_depths,
    selected_depths,
    tree_adjacency,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from run_local_rq34 import validate_rq3


@pytest.fixture
def prepared(tmp_path):
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="local-validation",
            content="(((a,b)c,d)e,(f,g)h)root;",
        )
    ).dataset
    store = PreparedLayoutStore(tmp_path)
    result = PreparedLayoutWorker(store).prepare_dataset(dataset)
    cuts = selected_depths(
        rooted_depths(tree_adjacency(dataset), dataset.technical_roots)
    )
    return dataset, store, result.artifacts.layout_version, cuts


def test_local_validation_covers_every_prepared_tier(prepared):
    rows = validate_rq3(*prepared)
    assert all(row["invariants"] == "PASS" for row in rows)
    assert rows[-1]["aggregates"] == 0
    assert rows[-1]["representations"] == len(prepared[0].nodes)


def test_missing_member_is_rejected(prepared):
    with sqlite3.connect(prepared[1].path) as connection:
        connection.execute(
            "delete from cluster_members where rowid=(select min(rowid) from cluster_members)"
        )
    with pytest.raises(AssertionError):
        validate_rq3(*prepared)


def test_missing_quotient_edge_is_rejected(prepared):
    with sqlite3.connect(prepared[1].path) as connection:
        connection.execute(
            "delete from prepared_edges where rowid=(select min(rowid) from prepared_edges where lod_level=0)"
        )
    with pytest.raises(AssertionError):
        validate_rq3(*prepared)


def test_changed_canonical_distance_is_rejected(prepared):
    with sqlite3.connect(prepared[1].path) as connection:
        connection.execute(
            "update graph_edges set distance=123 where rowid=(select min(rowid) from graph_edges)"
        )
    with pytest.raises(AssertionError):
        validate_rq3(*prepared)
