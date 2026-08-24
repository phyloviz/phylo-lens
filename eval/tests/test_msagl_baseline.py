from argparse import Namespace
from pathlib import Path
from phylo_lens_eval.msagl_baseline import (
    RUN_ID_PATTERN,
    TIMEOUT_SECONDS,
    UPSTREAM_COMMIT,
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
    assert RUN_ID_PATTERN.fullmatch("thesis-msagljs-mds-v001-001")
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
