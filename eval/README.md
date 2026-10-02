# PhyloLens thesis evaluation

Start with [current results](CURRENT_RESULTS_20261002.md) for Chapter 5, then
[the complete protocol](CURRENT_EVALUATION.md) for timing boundaries, versions,
warm-ups, validity checks and limitations. [The results index](results/README.md)
identifies each authoritative report and its raw evidence.

## Current campaign

| Question | Implementation / audit | Evidence |
|---|---|---|
| RQ1 — preparation | `scripts/run_preparation_evaluation.py --campaign rq1`; `scripts/audit_preparation_evaluation.py` | Completed: 50 measurements + 10 excluded warm-ups; independent audit passed |
| RQ2 — replay and integrated viewport | `scripts/run_final_local_evidence.py --current-source`; `scripts/audit_final_local_evidence.py` | Current combined RQ2/RQ4 report |
| RQ3 — prepared hierarchy | `scripts/run_local_rq34.py`; hierarchy checks in the combined audit | Fresh 100k master and all 15 levels |
| RQ4 — interaction | Same combined runner/auditor as RQ2 | Small 2, intermediate 88, large 3,796 members |
| External first visual | Preparation runner `--campaign external`; preparation auditor | Audited consolidation of first nine sizes and replacement 200k cell |
| MSAGL MDS preparation | `src/phylo_lens_eval/baselines/` | Preserved historical raw plus paired parsing-excluded analysis |

Commands run from the repository root. The shared current runner sources remain
in `scripts/` because current campaigns start child services that import them.
There is one implementation per runner; no copied version-suffixed entrypoints.

## Directory guide

- `browser/`: browser measurements, fixtures and validity checks; shared by runners.
- `src/phylo_lens_eval/core/`: configuration, environment, statistics and shared Full-MST definitions.
- `src/phylo_lens_eval/final/`: reproducible historical release protocols.
- `src/phylo_lens_eval/pilots/`: discovery and diagnostic protocols used by existing tests.
- `src/phylo_lens_eval/baselines/`: pinned MSAGL baseline and independent audit.
- `src/phylo_lens_eval/reporting/`: historical reconciliation and publication rendering.
- `config/`, `schemas/`, `tests/`: experiment definitions, raw contracts and harness tests.
- `tools/export_results.py`: reproducibility bundle planner/exporter for Zenodo.
- `docs/archive/`: historical protocols and setup notes; not the current scientific summary.
- `docs/cleanup-20261002.json`: removed wrappers and relocation map; original raw contents unchanged.
- `results/`: authoritative evidence, derived reports and separately archived diagnostics.

The flat Python compatibility wrappers were removed. Use the structured module
entrypoints, for example `phylo_lens_eval.final.rq1.rq1_final`,
`phylo_lens_eval.baselines.msagl_baseline`, or
`phylo_lens_eval.reporting.publication_artifacts`. Historical commands are updated
in [the archived guide](docs/archive/LEGACY_README.md).

## Verification and publication

Lightweight Python harness tests: `rtk proxy .venv/bin/python -m pytest eval/tests`.
Run browser/performance campaigns separately, with no competing benchmarks.
Do not start tests or compression jobs while a timed campaign is running.

Results are intentionally ignored by Git. A Git commit alone will not preserve
local measurements: use the explicit [publication plan](publication.json).
Preview its contents with `rtk proxy .venv/bin/python eval/tools/export_results.py`.
The exporter requires a completed, successfully audited RQ1 before writing the
archive. It includes raw observations, controls, source snapshots, reports,
inputs, audits and per-file SHA-256 checksums. Historical and smoke runs are
excluded from the current bundle except the explicitly identified MSAGL baseline.
No upload or version publication is performed by this tool.

## Chapter 5 figures

Run `rtk proxy .venv/bin/python eval/tools/generate_chapter5_figures.py` from the
repository root. [Figure documentation](FIGURES.md) describes outputs, optional
figures, reproduction and scientific boundaries. PDFs are vector outputs with
no internal titles; captions remain in LaTeX. The completed RQ1 is included.

Zenodo upload directory: `eval/results/publication/`. Upload the verified
`phylo-lens-thesis-evidence-20261002.tar.gz` and its `.sha256` sidecar; this is
the full selected reproducibility bundle, distinct from the compact Chapter 5 ZIP.
Do not upload all of `eval/results/`, which also retains superseded campaigns.
