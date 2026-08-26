from __future__ import annotations

from pathlib import Path
import sqlite3
from types import SimpleNamespace

import pytest

from phylo_lens_eval.common import create_isolated_run_directory
from phylo_lens_eval.rq3_final import (
    DEVELOPMENT_RUN_ID_PATTERN,
    FINAL_RUN_ID_PATTERN,
    _expected_quotient,
    _validate_case,
    _validate_run_id,
    canonical_bytes,
    canonicalize,
    load_config,
    sha256,
    _assert_sealed_master,
    _seal_master,
)
from phylo_lens_eval.rq3_final_audit import build_reports
from phylo_lens_eval.rq3_final_audit import _audit_retained_master


def test_final_config_freezes_independent_complete_source_universe() -> None:
    config = load_config()
    assert config["dataset"]["declared_node_count"] == 13075
    assert config["dataset"]["declared_edge_count"] == 13074
    assert config["dataset"]["expected_canonical_sha256"] == (
        "d0911c01bf4e149fc229812243717f91ce50343435a28f4e6b174d2166e638e9"
    )
    assert config["lod_levels"] == [0, 1, 2]
    assert config["expected_persisted_level_count"] == 3
    assert config["retries"] == 0


def test_final_and_development_run_ids_are_separate() -> None:
    assert FINAL_RUN_ID_PATTERN.fullmatch("thesis-final-rq3-v020-001")
    assert DEVELOPMENT_RUN_ID_PATTERN.fullmatch("dev-rq3-final-level0-smoke-001")
    for invalid in ("thesis-final-rq3-v020-01", "rq3", "dev-rq3-final-UPPER"):
        with pytest.raises(ValueError):
            _validate_run_id(invalid)


def test_existing_raw_run_directory_is_refused(tmp_path: Path) -> None:
    create_isolated_run_directory(
        tmp_path, "rq3-lod-final-v020", "thesis-final-rq3-v020-001"
    )
    with pytest.raises(FileExistsError):
        create_isolated_run_directory(
            tmp_path, "rq3-lod-final-v020", "thesis-final-rq3-v020-001"
        )


def test_canonical_float_serialization_is_exact_and_deterministic() -> None:
    assert canonicalize({"x": 0.1}) == {"x": {"float_hex": float(0.1).hex()}}
    assert canonical_bytes({"b": 2, "a": 1.0}) == canonical_bytes({"a": 1.0, "b": 2})
    assert sha256([0.1]) != sha256([0.10000000000000002])


def test_known_small_graph_quotient_deduplicates_and_retains_support() -> None:
    edges = [
        ("e1", "a", "b", 1.0),
        ("e2", "b", "c", 2.0),
        ("e3", "a", "c", 3.0),
        ("e4", "c", "d", 4.0),
    ]
    expected, support, unmapped = _expected_quotient(
        edges, {"a": "a", "b": "a", "c": "c", "d": "d"}
    )
    assert expected == {("a", "c"), ("c", "d")}
    assert [edge[0] for edge in support[("a", "c")]] == ["e2", "e3"]
    assert unmapped == []


def test_quotient_rejects_incomplete_group_mapping_without_deriving_membership() -> (
    None
):
    expected, support, unmapped = _expected_quotient(
        [("e1", "a", "b", None)], {"a": "a"}
    )
    assert expected == set()
    assert support == {}
    assert unmapped == ["e1"]


def _case_inputs(
    monkeypatch: pytest.MonkeyPatch,
    *,
    memberships: dict[str, list[str]],
    aggregate_xy: tuple[float, float] = (0.0, 0.0),
    edges: tuple[SimpleNamespace, ...] = (),
) -> tuple[SimpleNamespace, dict, dict]:
    import phylo_lens_eval.rq3_final as rq3

    positions = {
        "a": (0.0, 0.0, "cluster", "ready"),
        "b": (1.0, 0.0, "cluster", "ready"),
        "c": (2.0, 0.0, "singleton", "ready"),
    }
    monkeypatch.setattr(rq3, "_load_positions", lambda *_: positions)
    monkeypatch.setattr(rq3, "_load_memberships", lambda *_: memberships)
    aggregate = SimpleNamespace(
        node_id="a",
        cluster_id="cluster",
        member_count=2,
        x=aggregate_xy[0],
        y=aggregate_xy[1],
    )
    explicit = SimpleNamespace(
        node_id="c", cluster_id="singleton", member_count=1, x=2.0, y=0.0
    )
    view = SimpleNamespace(
        nodes=(aggregate, explicit),
        edges=edges,
        truncated=False,
        global_bounds=SimpleNamespace(min_x=0.0, max_x=2.0, min_y=0.0, max_y=0.0),
    )
    source = {
        "node_ids": ("a", "b", "c"),
        "edges": (("ab", "a", "b", None), ("bc", "b", "c", None)),
        "dataset": SimpleNamespace(dataset_id="dataset"),
    }
    return (
        view,
        source,
        {"database_path": "/not-read.sqlite3", "prepared_layout_id": "layout"},
    )


def test_membership_partition_rejects_duplicates_and_explicit_member_overlap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    view, source, layout = _case_inputs(
        monkeypatch, memberships={"cluster": ["a", "c", "c"]}
    )
    result = _validate_case(view, source, layout, {}, {})
    assert result["mismatches"]["duplicate_or_overlapping_members"]
    assert result["mismatches"]["explicit_member_overlap"] == ["c"]
    assert result["mismatches"]["member_count"]


def test_coordinate_and_quotient_edge_mismatches_are_retained(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    view, source, layout = _case_inputs(
        monkeypatch,
        memberships={"cluster": ["a", "b"]},
        aggregate_xy=(9.0, 0.0),
        edges=(SimpleNamespace(edge_id="bad", source="a", target="b", distance=None),),
    )
    result = _validate_case(view, source, layout, {}, {})
    assert result["mismatches"]["representative_positions"]
    assert result["mismatches"]["missing_quotient_edges"] == [("a", "c")]
    assert result["mismatches"]["unsupported_quotient_edges"] == [("a", "b")]


def test_deterministic_reports_regenerate_byte_for_byte(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    case = {
        "case_id": "lod-level-0",
        "status": "success",
        "level": {"lod_level": 0, "threshold": 4.0},
        "reduction": {
            "represented_source_nodes": 4,
            "materialized_visual_nodes": 2,
            "materialized_edges": 1,
            "triangle_proxy_count": 1,
            "visual_primitives": 4,
            "full_detail_primitives": 7,
            "materialization_ratio": 0.5,
            "node_reduction_factor": 2.0,
            "primitive_reduction_ratio": 0.4,
            "materialized_edge_reduction_ratio": 0.5,
        },
        "membership": {"expected_count": 4},
        "mismatches": {},
        "positions": {},
        "quotient_connectivity": {},
    }
    (run_dir / "manifest.json").write_text(
        '{"run_id":"thesis-final-rq3-v020-001","scientific_question":"q","product":{},"source":{},"layout":{},"policy":{}}'
    )
    (run_dir / "observations.jsonl").write_text(__import__("json").dumps(case) + "\n")
    first = build_reports(run_dir, "a" * 40, {"pass": True})
    assert first == build_reports(run_dir, "a" * 40, {"pass": True})
    assert {
        "rq3-summary.json",
        "rq3-lod-reduction.csv",
        "rq3-membership-validation.json",
        "rq3-position-validation.json",
        "rq3-quotient-connectivity.json",
        "rq3-provenance.json",
        "rq3-lod-reduction.svg",
    } == set(first)


def test_sealing_copies_stable_master_then_makes_it_read_only(tmp_path: Path) -> None:
    source_root, retained_root = tmp_path / "source", tmp_path / "retained"
    source_root.mkdir()
    database = source_root / "prepared_layout.sqlite3"
    connection = sqlite3.connect(database)
    connection.execute("create table sample (value integer)")
    connection.execute("insert into sample values (1)")
    connection.commit()
    connection.close()

    _seal_master(database, retained_root)

    retained = retained_root / database.name
    assert retained.read_bytes() == database.read_bytes()
    assert retained.stat().st_mode & 0o222 == 0
    assert not retained.with_name(retained.name + "-wal").exists()
    assert not retained.with_name(retained.name + "-shm").exists()
    _assert_sealed_master(retained)


def test_immutable_inspection_does_not_create_sqlite_sidecars(tmp_path: Path) -> None:
    source_root, retained_root = tmp_path / "source", tmp_path / "retained"
    source_root.mkdir()
    database = source_root / "prepared_layout.sqlite3"
    connection = sqlite3.connect(database)
    connection.execute("create table sample (value integer)")
    connection.commit()
    connection.close()
    _seal_master(database, retained_root)
    retained = retained_root / database.name

    connection = sqlite3.connect(f"file:{retained}?mode=ro&immutable=1", uri=True)
    assert connection.execute("select count(*) from sample").fetchone()[0] == 0
    connection.close()
    assert not retained.with_name(retained.name + "-wal").exists()
    assert not retained.with_name(retained.name + "-shm").exists()


def test_audit_recomputes_retained_physical_hash_and_semantic_hashes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    master = tmp_path / "prepared-layout"
    master.mkdir()
    database = master / "prepared_layout.sqlite3"
    database.write_bytes(b"sealed bytes")
    database.chmod(0o444)
    source = {"dataset_id": "dataset", "node_ids": [], "edges": []}
    layout = {
        "database_sha256": "0" * 64,
        "prepared_layout_id": "layout",
        "table_sha256": {"node_positions": "recorded"},
        "levels": [],
        "bounds": {},
        "source_position_count": 0,
        "source_graph_edge_count": 0,
    }
    monkeypatch.setattr(
        "phylo_lens_eval.rq3_final.inspect_layout",
        lambda *_args, **_kwargs: {
            "table_sha256": {"node_positions": "different"},
            "levels": [],
            "bounds": {},
            "source_position_count": 0,
            "source_graph_edge_count": 0,
        },
    )
    errors: list[str] = []
    _audit_retained_master(
        tmp_path, source, layout, {"dataset": {"id": "dataset"}}, errors
    )
    assert any("physical SHA256" in error for error in errors)
    assert any("semantic table hashes" in error for error in errors)
