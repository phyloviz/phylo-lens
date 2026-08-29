import csv
import json
from pathlib import Path

import pytest

from phylo_lens_eval.final_evidence_index import verify_external_comparison
from phylo_lens_eval.stats import summary


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _external_fixture(tmp_path: Path) -> Path:
    root = tmp_path / "phylo-lens"
    thesis = tmp_path / "Thesis"
    combined = (
        thesis
        / "results/derived/final-external-fullmst-combined-v020"
        / "thesis-final-fullmst-combined-v020-004"
    )
    original = (
        thesis / "results/raw/final/final-external-fullmst/thesis-final-fullmst-001"
    )
    replacement = (
        thesis
        / "results/raw/final/final-external-fullmst-phylolens-0.2.0"
        / "thesis-final-fullmst-phylolens-v020-004"
    )
    source_roots = {
        "phylolens": replacement,
        "phylotree": original,
        "taxonium": original,
    }
    matrix, timing_rows, outcome_rows = [], [], []
    for tool_index, tool in enumerate(sorted(source_roots)):
        for dataset_index in range(10):
            dataset = f"dataset-{dataset_index}"
            source = source_roots[tool]
            values = [
                float(tool_index * 100 + dataset_index * 10 + repetition)
                for repetition in range(3)
            ]
            for phase, repetition, value in [
                ("warmup", 0, -1.0),
                *(("measured", i, value) for i, value in enumerate(values)),
            ]:
                _write_json(
                    source
                    / "observations"
                    / f"{tool}-{dataset}-{phase}-{repetition}.json",
                    {
                        "tool_id": tool,
                        "dataset_id": dataset,
                        "phase": phase,
                        "status": "success",
                        "time_to_first_visual_output_ms": value,
                    },
                )
            stats = summary(values)
            assert stats is not None
            run_id = (
                "thesis-final-fullmst-phylolens-v020-004"
                if tool == "phylolens"
                else "thesis-final-fullmst-001"
            )
            base = {
                "tool_id": tool,
                "dataset_id": dataset,
                "source_run_dir": str(source),
                "source_run_id": run_id,
                "failure_count": 0,
                "timeout_count": 0,
                "measured_count": 3,
                "warmup_count": 1,
            }
            matrix.append(base)
            outcome_rows.append(base)
            timing_rows.append(
                {
                    **base,
                    "successful_count": 3,
                    "median_ms": stats["median"],
                    "p25_ms": stats["p25"],
                    "p75_ms": stats["p75"],
                    "iqr_ms": stats["iqr"],
                }
            )
    combined.mkdir(parents=True)
    _write_json(
        combined / "combined-final-audit.json",
        {
            "status": "passed",
            "report_congruent": True,
            "original_run": {"run_id": "thesis-final-fullmst-001"},
            "replacement_run_audit": {
                "run_id": "thesis-final-fullmst-phylolens-v020-004"
            },
        },
    )
    _write_json(combined / "combined-external-summary.json", {"matrix": matrix})
    for name, rows in {
        "combined-external-timing-summary.csv": timing_rows,
        "combined-external-success-failure-scaling.csv": outcome_rows,
    }.items():
        with (combined / name).open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=sorted(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    (combined / "combined-external-topology-identity-status.csv").write_text(
        "tool_id,status\nphylolens,VERIFIED\n", encoding="utf-8"
    )
    return root


def test_verify_external_comparison_recomputes_all_retained_rows(
    tmp_path: Path,
) -> None:
    evidence = verify_external_comparison(_external_fixture(tmp_path))

    assert evidence["matrix_rows"] == 30
    assert evidence["selected_measured"] == 90
    assert evidence["selected_warmups"] == 30
    assert evidence["selected_terminal_observations"] == 120


def test_verify_external_comparison_rejects_mismatched_timing(tmp_path: Path) -> None:
    root = _external_fixture(tmp_path)
    timing = (
        root.parent
        / "Thesis/results/derived/final-external-fullmst-combined-v020"
        / "thesis-final-fullmst-combined-v020-004/combined-external-timing-summary.csv"
    )
    rows = list(csv.DictReader(timing.open(encoding="utf-8", newline="")))
    rows[0]["median_ms"] = "9999"
    with timing.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    with pytest.raises(ValueError, match="median_ms mismatch"):
        verify_external_comparison(root)
