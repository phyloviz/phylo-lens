"""Measurement failures must not be silently accepted by the preparation runner."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import run_preparation_evaluation as evaluation


def test_sampling_write_failure_reaches_measurement_caller(tmp_path):
    sampler = evaluation.ProcessSampler(1, tmp_path / "resources.jsonl")
    sampler.sample = Mock(side_effect=OSError("disk full"))
    with (
        pytest.raises(RuntimeError, match="Resource sampling failed: disk full"),
        sampler,
    ):
        pass


def test_storage_guard_prevents_creating_a_new_raw_run(monkeypatch, tmp_path):
    monkeypatch.setattr(evaluation, "ROOT", tmp_path)
    monkeypatch.setattr(
        evaluation.shutil, "disk_usage", lambda _: SimpleNamespace(free=1024)
    )
    with pytest.raises(OSError, match="No new observation started"):
        evaluation.run(SimpleNamespace(nodes=[200000]))
    assert list(tmp_path.iterdir()) == []
