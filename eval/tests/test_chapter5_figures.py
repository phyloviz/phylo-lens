"""Mathematical and publication guards for the current figure generator."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "chapter5_figures",
    Path(__file__).parents[1] / "scripts/generate_chapter5_figures.py",
)
figures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(figures)


def test_inclusive_quantiles_preserve_small_sample_intervals():
    assert figures.quantile([0, 10, 100], 0.25) == 5
    assert figures.quantile([0, 10, 100], 0.75) == 55
    assert figures.statistics([10]) == dict(
        n=1, median=10, p25=10, p75=10, minimum=10, maximum=10
    )
    with pytest.raises(ValueError):
        figures.statistics([])
    with pytest.raises(ValueError):
        figures.statistics([float("nan")])


def test_warmups_failures_and_invalid_observations_are_excluded():
    rows = [
        dict(warmup=True, status="success", valid=True),
        dict(warmup=False, status="timeout", valid=True),
        dict(warmup=False, status="success", valid=False),
        dict(warmup=False, status="success", valid=True, value=42),
    ]
    assert figures.measured(rows) == [rows[-1]]


def test_grouping_keeps_metrics_per_condition():
    rows = [dict(condition="small", size=2, value=v) for v in [1, 3, 100]]
    rows += [dict(condition="large", size=200, value=200)]
    result = figures.aggregate(
        rows, lambda r: r["value"], lambda r: r["size"], lambda r: "series"
    )
    assert result[0]["n"] == 3 and result[0]["median"] == 3
    assert result[1]["n"] == 1 and result[1]["median"] == 200


def test_embedded_titles_are_rejected_before_writing(tmp_path, monkeypatch):
    pytest.importorskip("matplotlib")
    monkeypatch.setenv("MPLCONFIGDIR", str(tmp_path / "cache"))
    renderer = figures.Renderer(tmp_path / "output", {}, 72)
    fig, ax = renderer.axes()
    ax.set_title("Forbidden duplicate caption")
    with pytest.raises(AssertionError):
        renderer.save(fig, "bad", [dict(value=1)], "External caption")
    assert not (tmp_path / "output/bad.pdf").exists()
    renderer.plt.close(fig)
