"""Tiny filesystem checks; no product service or browser is launched."""

import importlib.util
import json
import tarfile
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "export_results", Path(__file__).parents[1] / "scripts/export_results.py"
)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


@pytest.fixture
def evidence(tmp_path):
    root = tmp_path / "repo"
    run = root / "eval/results/local/rq1"
    run.mkdir(parents=True)
    (run / "manifest.json").write_text(json.dumps({"state": "completed"}))
    (run / "audit.json").write_text(json.dumps({"passed": True}))
    (run / "raw.json").write_text('{"measurement": 42}')
    cache = run / "node_modules"
    cache.mkdir()
    (cache / "ignored.txt").write_text("dependency")
    (run / ".env").write_text("fixture-only local configuration")
    store = run / ".phylo_lens_store"
    store.mkdir()
    (store / "unrelated-cache.json").write_text("{}")
    (run / "linked-input").symlink_to(run / "raw.json")
    thesis = tmp_path / "Thesis"
    inputs = thesis / "data/salmonella/fullmst"
    inputs.mkdir(parents=True)
    source = inputs / "tree.nwk"
    source.write_text("(a,b);")
    registry = root / "eval/config/inputs.json"
    registry.parent.mkdir()
    registry.write_text(
        json.dumps(
            {"conditions": [{"path": source.name, "sha256": exporter.digest(source)}]}
        )
    )
    plan = {
        "paths": ["eval/results/local/rq1"],
        "rq1_run": "eval/results/local/rq1",
        "input_registry": "eval/config/inputs.json",
        "excluded_directory_names": ["node_modules", ".phylo_lens_store"],
        "excluded_filename_patterns": [".env", ".env.*"],
    }
    return root, thesis, plan


def test_archive_preserves_raw_and_includes_verified_inputs(evidence, tmp_path):
    root, thesis, plan = evidence
    files, registry = exporter.selected_files(root, plan, thesis)
    assert not any(
        "node_modules" in name
        or "linked-input" in name
        or ".phylo_lens_store" in name
        or name.endswith(".env")
        for name in files
    )
    raw = root / plan["rq1_run"] / "raw.json"
    original = raw.read_bytes()
    output = tmp_path / "evidence.tar.gz"
    result = exporter.export(root, plan, files, registry, output)
    assert result["sha256"] == exporter.digest(output)
    with tarfile.open(output) as archive:
        assert archive.extractfile("eval/results/local/rq1/raw.json").read() == original
        assert archive.extractfile("inputs/fullmst/tree.nwk").read() == b"(a,b);"
        manifest = json.load(archive.extractfile("BUNDLE_MANIFEST.json"))
        assert manifest["inputs_verified"] is True
    assert raw.read_bytes() == original
    with pytest.raises(ValueError, match="overwrite"):
        exporter.export(root, plan, files, registry, output)


@pytest.mark.parametrize("state,audit", [("running", True), ("completed", False)])
def test_incomplete_or_unaudited_rq1_cannot_export(evidence, tmp_path, state, audit):
    root, thesis, plan = evidence
    run = root / plan["rq1_run"]
    (run / "manifest.json").write_text(json.dumps({"state": state}))
    (run / "audit.json").write_text(json.dumps({"passed": audit}))
    files, registry = exporter.selected_files(root, plan, thesis)
    output = tmp_path / "blocked.tar.gz"
    with pytest.raises(ValueError):
        exporter.export(root, plan, files, registry, output)
    assert not output.exists()
    assert not output.with_name(output.name + ".partial").exists()


def test_changed_input_is_rejected_before_archive_creation(evidence, tmp_path):
    root, thesis, plan = evidence
    files, registry = exporter.selected_files(root, plan, thesis)
    files["inputs/fullmst/tree.nwk"].write_text("(a,c);")
    output = tmp_path / "blocked.tar.gz"
    with pytest.raises(ValueError, match="hash mismatch"):
        exporter.export(root, plan, files, registry, output)
    assert not output.exists()
