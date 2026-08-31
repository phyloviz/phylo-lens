from __future__ import annotations

import argparse
from pathlib import Path

import pytest

import phylo_lens_eval.final.rq1.rq1_final as rq1_final
from phylo_lens_eval.final.rq1.rq1_final import (
    FinalRQ1Error,
    _validate_run_id,
    load_config,
    raw_summary,
    repository_root,
    run,
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


def _retained_final_inputs_available() -> bool:
    root = repository_root()
    config = load_config()
    return all(
        rq1_final.condition_path(root, config, condition).is_file()
        for condition in config["conditions"]
    )


@pytest.mark.skipif(
    not _retained_final_inputs_available(),
    reason="requires retained final RQ1 inputs excluded from a clean checkout",
)
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
    assert config["startup_timeout_seconds"] == 30
    assert config["preparation_timeout_seconds"] == 300
    assert config["outer_watchdog_seconds"] == 345
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


def _run_args(run_id: str, results_root: Path) -> argparse.Namespace:
    return argparse.Namespace(
        run_id=run_id, results_root=results_root, thesis_root=None
    )


def _without_observations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        rq1_final,
        "preflight",
        lambda root, config, thesis_root: {"verified_conditions": []},
    )


def test_retained_v020_001_is_rejected_when_its_raw_directory_exists(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _without_observations(monkeypatch)
    config = load_config()
    existing = tmp_path / config["id"] / "thesis-final-rq1-v020-001"
    existing.mkdir(parents=True)

    with pytest.raises(FinalRQ1Error, match="already exists"):
        run(_run_args("thesis-final-rq1-v020-001", tmp_path))


def test_absent_v020_002_is_accepted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _without_observations(monkeypatch)

    run_dir = run(_run_args("thesis-final-rq1-v020-002", tmp_path))

    assert run_dir == tmp_path / "rq1-final-oci-v020" / "thesis-final-rq1-v020-002"
    assert run_dir.is_dir()


@pytest.mark.parametrize(
    "run_id",
    [
        "thesis-final-rq1-v020-01",
        "thesis-final-rq1-v020-0001",
        "thesis-final-rq1-v019-002",
        "thesis-final-rq1-v020-002-extra",
        "rq1-final-v020-002",
    ],
)
def test_malformed_or_nonapproved_run_ids_are_rejected(run_id: str) -> None:
    with pytest.raises(FinalRQ1Error, match="must match"):
        _validate_run_id(run_id)


def test_existing_v020_002_is_rejected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _without_observations(monkeypatch)
    config = load_config()
    existing = tmp_path / config["id"] / "thesis-final-rq1-v020-002"
    existing.mkdir(parents=True)

    with pytest.raises(FinalRQ1Error, match="already exists"):
        run(_run_args("thesis-final-rq1-v020-002", tmp_path))
