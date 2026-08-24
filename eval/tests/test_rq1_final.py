from __future__ import annotations

from phylo_lens_eval.rq1_final import (
    load_config,
    raw_summary,
    repository_root,
    verified_conditions,
)


def _row(
    *, condition_id: str, phase: str, status: str, memory_scope: str, rss: int | None
) -> dict:
    return {
        "condition_id": condition_id,
        "requested_leaves": 5000,
        "parsed_nodes": 9999,
        "parsed_edges": 9998,
        "topology": "balanced",
        "seed": None,
        "input_sha256": "a" * 64,
        "phase": phase,
        "status": status,
        "timing": {"preparation_wall_ms": 10.0 if status == "success" else None},
        "memory": {"scope": memory_scope, "peak_rss_bytes": rss},
    }


def test_final_matrix_is_exact_and_retained_inputs_verify() -> None:
    config = load_config()
    conditions = verified_conditions(repository_root(), config)
    assert len(conditions) == 15
    assert {(item["requested_leaves"], item["topology"]) for item in conditions} == {
        (leaves, topology)
        for leaves in (5000, 10000, 25000, 50000, 100000)
        for topology in ("balanced", "irregular", "caterpillar")
    }
    assert config["warmup_repetitions"] == 1
    assert config["measured_repetitions"] == 5
    assert config["preparation_timeout_seconds"] == 300
    assert config["poll_interval_ms"] == 100
    assert config["rss_sampling_interval_ms"] == 20


def test_summary_never_substitutes_non_tree_memory() -> None:
    rows = [
        _row(
            condition_id="balanced-5000",
            phase="warmup",
            status="success",
            memory_scope="process_tree",
            rss=10,
        ),
        _row(
            condition_id="balanced-5000",
            phase="measured",
            status="success",
            memory_scope="process_tree",
            rss=20,
        ),
        _row(
            condition_id="balanced-5000",
            phase="measured",
            status="success",
            memory_scope="unavailable",
            rss=None,
        ),
        _row(
            condition_id="balanced-5000",
            phase="measured",
            status="timeout",
            memory_scope="unavailable",
            rss=None,
        ),
    ]
    group = raw_summary(rows)["groups"][0]
    assert group["warmup_count"] == 1
    assert group["measured_count"] == 3
    assert group["success_count"] == 2
    assert group["timeout_count"] == 1
    assert group["parsed_nodes"] == 9999
    assert group["process_tree_peak_rss_bytes"]["median"] == 20
    assert group["memory_unavailable_count"] == 1
