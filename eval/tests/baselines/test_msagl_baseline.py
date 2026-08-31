from argparse import Namespace
from pathlib import Path
import sys

import pytest

from phylo_lens_eval.baselines.msagl_baseline import (
    DEVELOPMENT_SMOKE_RUN_ID_PATTERN,
    NATIVE_MAX_MEMORY_BYTES,
    RUN_ID_PATTERN,
    TILE_CAPACITY,
    TILE_LEVEL_UPPER_BOUND,
    TIMEOUT_SECONDS,
    UPSTREAM_COMMIT,
    _execute_observation,
    adapt_newick,
    repetition_plan,
    run,
    validate_adaptation,
)


def test_adapter_is_deterministic_and_preserves_topology(tmp_path: Path):
    p = tmp_path / "tree.nwk"
    p.write_text("((a,b),c);")
    a, b = adapt_newick(p), adapt_newick(p)
    assert a["payload"] == b["payload"]
    assert a["source_sha256"] == b["source_sha256"]
    assert a["adapted_sha256"] == b["adapted_sha256"]
    assert set(a["nodes"]) == {"a", "b", "c", "internal-0", "internal-1"}
    assert set(a["edges"]) == {
        ("internal-0", "internal-1"),
        ("a", "internal-1"),
        ("b", "internal-1"),
        ("c", "internal-0"),
    }
    validate_adaptation(a, nodes=5, edges=4)


def test_frozen_contract():
    assert UPSTREAM_COMMIT == "db1ecbba39f46ca83aa90a87bad2012757e51f42"
    assert TIMEOUT_SECONDS == 300
    assert TILE_LEVEL_UPPER_BOUND == 30
    assert TILE_CAPACITY == 500
    assert NATIVE_MAX_MEMORY_BYTES == 4 * 1024 * 1024 * 1024
    assert RUN_ID_PATTERN.fullmatch("thesis-msagljs-mds-v001-001")
    assert DEVELOPMENT_SMOKE_RUN_ID_PATTERN.fullmatch("dev-msagljs-mds-smoke-001")
    assert not RUN_ID_PATTERN.fullmatch("bad")
    assert repetition_plan() == [
        ("warmup", 0, True),
        ("measured", 0, False),
        ("measured", 1, False),
        ("measured", 2, False),
        ("measured", 3, False),
        ("measured", 4, False),
    ]


def test_existing_raw_run_is_refused(tmp_path: Path):
    run_id = "thesis-msagljs-mds-v001-001"
    (tmp_path / "rq5-msagljs-current-mds-v001" / run_id).mkdir(parents=True)
    try:
        run(Namespace(run_id=run_id, results_root=tmp_path, upstream=tmp_path))
    except FileExistsError:
        return
    raise AssertionError("existing raw directory was not refused")


def test_outer_watchdog_retains_timeout_evidence_and_allows_next_observation(
    tmp_path: Path,
):
    timed_out_directory = tmp_path / "timed-out"
    timed_out_directory.mkdir()
    calls = 0
    timeout_state, timeout_payload, timeout_watchdog = _execute_observation(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        timed_out_directory,
        0.05,
    )
    calls += 1
    assert timeout_state == "timeout"
    assert timeout_payload["outer_watchdog"]["timed_out"] is True
    assert timeout_watchdog["process_group_terminated"] is True
    assert timeout_watchdog["returncode"] != 0
    assert (timed_out_directory / "outer-watchdog.json").is_file()
    assert (timed_out_directory / "runner.stdout.txt").is_file()
    assert (timed_out_directory / "runner.stderr.txt").is_file()

    next_directory = tmp_path / "next"
    next_directory.mkdir()
    next_state, next_payload, _ = _execute_observation(
        [sys.executable, "-c", 'print(\'{"status": "success"}\')'],
        next_directory,
        1,
    )
    calls += 1
    assert next_state == "success"
    assert next_payload["status"] == "success"
    assert calls == 2  # One attempt each: the timeout was not retried.


def test_development_smoke_id_requires_smoke_flag(tmp_path: Path):
    with pytest.raises(ValueError, match="development smoke IDs"):
        run(
            Namespace(
                run_id="dev-msagljs-mds-smoke-001",
                results_root=tmp_path,
                upstream=tmp_path,
                smoke=False,
            )
        )
