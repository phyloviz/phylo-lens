from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path

import pytest

from phylo_lens_eval.rq3 import (
    counterbalanced_order,
    deterministic_pair_id,
    paired_responses,
    payload_bytes,
    ratio_metric,
    run,
    semantic_equivalence,
    synthetic_dataset,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)


def test_pair_id_is_deterministic_and_identity_bound() -> None:
    browser = {"viewport": {"width": 960, "height": 640}, "device_scale_factor": 1}
    first = deterministic_pair_id("a" * 64, "layout", "overview", browser, False, 0)
    assert first == deterministic_pair_id(
        "a" * 64, "layout", "overview", browser, False, 0
    )
    assert first != deterministic_pair_id(
        "b" * 64, "layout", "overview", browser, False, 0
    )


def test_persisted_members_reconstruct_full_detail_with_base_coordinates(
    tmp_path: Path,
) -> None:
    dataset = synthetic_dataset({"id": "tiny-rq3", "node_count": 300, "seed": 1})
    store = PreparedLayoutStore(tmp_path / "layout")
    prepared = PreparedLayoutWorker(store).prepare_dataset(dataset)
    _request, triangles, detail = paired_responses(
        store,
        prepared.artifacts.layout_version,
        dataset.dataset_id,
        {
            "id": "overview",
            "center_x_fraction": 0.5,
            "center_y_fraction": 0.5,
            "scale": 1.0,
            "lod_level": 0,
        },
    )
    semantic = semantic_equivalence(
        triangles,
        detail,
        store.path,
        dataset.dataset_id,
        prepared.artifacts.layout_version,
    )
    assert semantic["valid"]
    assert any(node["member_count"] > 1 for node in triangles["nodes"])
    persisted = {
        item.node_id: (item.x, item.y)
        for item in store.load_node_positions(
            dataset.dataset_id, prepared.artifacts.layout_version
        )
    }
    assert all(
        persisted[node["id"]] == (node["x"], node["y"]) for node in detail["nodes"]
    )
    assert len(detail["nodes"]) == semantic["triangle_represented_population"]


def test_population_mismatch_and_zero_denominator_are_explicit() -> None:
    mismatch = semantic_equivalence(
        {"nodes": [{"id": "a", "member_count": 1}]},
        {"nodes": [{"id": "b", "member_count": 1}]},
    )
    assert mismatch["valid"] is False
    assert mismatch["reason"] == "semantic_id_set_mismatch"
    assert ratio_metric(0, 0) == {
        "state": "unavailable",
        "value": None,
        "reason": "zero_denominator",
    }


def test_semantic_validation_rejects_equal_count_different_ids_and_duplicates(
    tmp_path: Path,
) -> None:
    database = tmp_path / "membership.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "create table cluster_members(dataset_id text, layout_version text, cluster_id text, node_id text)"
        )
        connection.executemany(
            "insert into cluster_members values ('d', 'l', ?, ?)",
            [("a", "one"), ("a", "two"), ("b", "two"), ("b", "three")],
        )
    overlap = semantic_equivalence(
        {
            "nodes": [
                {"id": "ra", "cluster_id": "a", "member_count": 2},
                {"id": "rb", "cluster_id": "b", "member_count": 2},
            ]
        },
        {"nodes": [{"id": "one"}, {"id": "two"}, {"id": "three"}]},
        database,
        "d",
        "l",
    )
    assert overlap["valid"] is False
    assert (
        overlap["reason"]
        == "Aggregate expansion failure: overlapping aggregate membership."
    )
    different_ids = semantic_equivalence(
        {"nodes": [{"id": "one", "member_count": 1}]},
        {"nodes": [{"id": "two"}]},
    )
    assert different_ids["reason"] == "semantic_id_set_mismatch"


def test_payload_and_counterbalanced_order_are_deterministic() -> None:
    response = {
        "nodes": [],
        "edges": [],
        "global_bounds": {"min_x": 0, "max_x": 1, "min_y": 0, "max_y": 1},
    }
    assert payload_bytes(response) == payload_bytes(
        dict(reversed(list(response.items())))
    )
    assert counterbalanced_order("rq3-0000000000000000", 0) != counterbalanced_order(
        "rq3-0000000000000000", 1
    )


@pytest.mark.skipif(
    os.environ.get("RQ3_SMOKE") != "1",
    reason="requires built browser and Playwright Chromium",
)
def test_tiny_headless_paired_smoke(tmp_path: Path) -> None:
    run_dir = run(
        argparse.Namespace(
            experiment="rq3-triangle-pilot",
            warmups=0,
            repetitions=1,
            results_root=tmp_path,
        )
    )
    pairs = [
        json.loads(line) for line in (run_dir / "pairs.jsonl").read_text().splitlines()
    ]
    assert pairs and all(pair["semantic_equivalence"]["valid"] for pair in pairs)
    assert all(
        pair["conditions"]["full_detail"]["status"] == "success" for pair in pairs
    )
