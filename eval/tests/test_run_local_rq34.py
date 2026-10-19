"""Local structural evidence must detect corrupt persisted partitions/edges."""

from phylo_lens_server.domain.models import SourceFormat
from phylo_lens_server.domain.lod import LodOptions

import sqlite3

import pytest
from phylo_lens_server.domain.preparation import PrepareInput
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    selected_depths,
)
from phylo_lens_server.services.preparation import PreparationService
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from run_local_rq34 import presentation_depths, validate_rq3


@pytest.fixture(
    params=[0, 64], ids=["aggregation-enabled", "small-component-protected"]
)
def prepared(tmp_path, request):
    dataset = ingest_dataset(
        PrepareInput(
            format=SourceFormat("newick"),
            dataset_name="local-validation",
            content="(((a,b)c,d)e,(f,g)h)root;",
        )
    ).dataset
    store = SQLiteLayoutRepository(tmp_path)
    limit = request.param
    result = PreparationService(store).prepare_dataset(
        dataset, lod_options=LodOptions(small_component_threshold=limit)
    )
    cuts = selected_depths(presentation_depths(dataset, limit))
    return dataset, store, result.artifacts.layout_version, cuts, limit


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


def test_presentation_oracle_protects_only_whole_components_within_the_limit():
    dataset = ingest_dataset(
        PrepareInput(format=SourceFormat("newick"), content="((a)b)r;((((e)d)c)z)s;")
    ).dataset
    depths = presentation_depths(dataset, 3)
    assert {key: depths[key] for key in ("r", "a", "b")} == {"r": 0, "a": 0, "b": 0}
    assert {key: depths[key] for key in ("s", "z", "c", "d", "e")} == {
        "s": 0,
        "z": 1,
        "c": 2,
        "d": 3,
        "e": 4,
    }
