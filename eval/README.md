# PhyloLens evaluation

This directory contains reproducible RQ1 server-side preparation and RQ2
client-side visualization evaluation harnesses. It does not contain RQ3, RQ4,
external-tool comparisons, or thesis-result claims.

Install the server and evaluation dependencies in one Python environment, from
the repository root:

```bash
python -m pip install -e 'code/server[test,dev]'
python -m pip install -e 'eval[test]'
PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq1 \
  --experiment rq1-direct-tree --dataset small-balanced-newick \
  --warmups 1 --repetitions 3 --timeout-seconds 60
```

The command creates an isolated run below
`eval/results/raw/<experiment-id>/<run-id>/`. The run root contains a manifest,
resolved configuration, combined raw observations, and a summary. Each dataset
subdirectory contains its own manifest, resolved configuration, raw
observations, per-repetition stdout/stderr, and a fresh SQLite directory for
each preparation. Results are ignored by Git and are not thesis evidence until
they are generated for a recorded environment and analysed.

Regenerate summaries from raw observations only:

```bash
PYTHONPATH=eval/src python -m phylo_lens_eval.summarize \
  eval/results/raw/<experiment-id>/<run-id>
```

`config/datasets.json` is the single dataset catalog and supports the explicit
topology labels required by the study. Paths are repository-relative. The RQ1
direct-tree experiment is declared in `config/experiments.json`; command-line
overrides are copied into `resolved-config.json`.

The repository has no suitable typing-profile benchmark dataset. Consequently,
this phase does not run or report typing-profile RQ1 results. A future dataset
entry must identify a profile file, use `typing_data`, and document its source
and goeBURST interpretation before that pipeline is enabled.

## RQ2 client-side visualization scalability

RQ2 uses synthetic graphical fixtures only; they are not biological or
phylogenetic datasets. Python creates an isolated
`eval/results/raw/rq2-client-pilot/<run-id>/` directory and invokes the bounded
Node/Playwright child once per warm-up or measured repetition. Each repetition
has its own request, Chromium runtime state, browser result, frame samples,
request samples, replay log, screenshot, stdout, and stderr.

Build both browser inputs, then run a small headless smoke:

```bash
(cd code/client && npm run build:lib)
(cd eval/browser && npm ci && npx playwright install chromium && npm run build)
PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq2 \
  --experiment rq2-client-pilot --warmups 0 --repetitions 1
```

Node stdout is exactly one final JSON record. Python owns manifests, schema
validation, process-tree RSS sampling, raw JSONL observations, and summaries.
The local replay server is an API contract fixture; its timings are diagnostics,
not server-performance measurements. Headless smoke outputs are CI validation,
not final thesis evidence.

## RQ3 paired triangle aggregation

Run the tiny synthetic paired ablation after building the same browser inputs:

```bash
PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq3 \
  --experiment rq3-triangle-pilot --warmups 0 --repetitions 1
```

RQ3 reads only persisted prepared-layout data to expand selected triangle
members into detail at their original coordinates. Its raw `pairs.jsonl` is the
statistical unit; it records both condition observations, semantic-population
validation, counterbalanced order, and pair-level reduction/difference metrics.
