from __future__ import annotations

from contextlib import contextmanager

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)


def test_prepared_layout_worker_stage_hook_is_opt_in_and_does_not_change_result(
    tmp_path,
) -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick", dataset_name="instrumented", content="(a:1,b:1)root;"
        )
    ).dataset
    normal = PreparedLayoutWorker(
        PreparedLayoutStore(tmp_path / "normal")
    ).prepare_dataset(dataset)
    stages: list[str] = []

    @contextmanager
    def stage(name: str):
        stages.append(name)
        yield

    instrumented = PreparedLayoutWorker(
        PreparedLayoutStore(tmp_path / "instrumented"), stage_factory=stage
    ).prepare_dataset(dataset)
    assert instrumented.artifacts == normal.artifacts
    assert instrumented.layout_status == normal.layout_status
    assert "lod_construction" in stages
    assert "base_layout" in stages
    assert any(name.startswith("persist_") for name in stages)


def test_prepared_layout_worker_ignores_stage_callback_failures(tmp_path) -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick", dataset_name="instrumented", content="(a:1,b:1)root;"
        )
    ).dataset

    def broken_stage(_name: str):
        raise RuntimeError("instrumentation failed")

    result = PreparedLayoutWorker(
        PreparedLayoutStore(tmp_path / "instrumented"), stage_factory=broken_stage
    ).prepare_dataset(dataset)
    assert result.layout_status == "ready"
