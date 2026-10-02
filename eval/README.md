# Evaluation

Run commands from the repository root. Python dependencies are defined in
`pyproject.toml`; browser dependencies and setup are in `browser/README.md`.
The measurement protocol is documented in [docs/protocol.md](docs/protocol.md).

| Purpose | Script in `eval/scripts/` |
|---|---|
| RQ1 preparation / external first visual | `run_preparation_evaluation.py`, `audit_preparation_evaluation.py` |
| RQ2 viewport / RQ4 expand and collapse | `run_final_local_evidence.py`, `audit_final_local_evidence.py` |
| RQ3 hierarchy validation | `run_local_rq34.py` |
| Historical medium-target correction | `rerun_medium_evidence.py` |
| Combine external campaigns | `combine_preparation_evidence.py` |
| External provenance / parsing analysis | `audit_external_comparison_details.py` |
| Synthetic LoD / layout experiments | `evaluate_lod_growth.py`, `benchmark_layout_readability.py` |
| Verified artifact compression | `compact_evaluation_artifacts.py` |
| Chapter 5 figures | `generate_chapter5_figures.py` |
| Zenodo archive | `export_results.py` |

`evaluation_runtime.py` and `local_eval_server.py` support the current runners.
`src/phylo_lens_eval/` contains shared utilities and historical protocols needed
to reproduce retained evidence. `config/` and `schemas/` define experiments and
raw record contracts; `tests/` validates the harnesses.

## Tests

```sh
rtk proxy .venv/bin/python -m pytest -c eval/pyproject.toml eval/tests
```

Run timed campaigns separately, without competing benchmarks or compression.
Use a new run ID for each campaign; retain its raw observations and source hashes.

## Results and figures

[results/README.md](results/README.md) identifies the authoritative reports.
Results are ignored by Git. Each campaign's saved source snapshot identifies
the measured implementation independently of the current checkout.

```sh
rtk proxy .venv/bin/python eval/scripts/generate_chapter5_figures.py
```

Install `requirements-figures.txt` if Matplotlib is unavailable. The generator
uses audited evidence and writes vector PDFs, PNGs, plotted CSVs, provenance,
and separate LaTeX captions to `results/derived/chapter5-figures-current/`.
Figures have no embedded titles. This command does not rerun benchmarks.

## Zenodo

`publication.json` selects the evidence and source files to include. Preview:

```sh
rtk proxy .venv/bin/python eval/scripts/export_results.py
```

Add `--output /path/to/new-archive.tar.gz` to create and verify an archive.
The exporter checks RQ1 completion, audits, input hashes and archive file hashes.
Upload the archive and its SHA-256 sidecar from `results/publication/`;
other directories also contain historical and diagnostic runs.
