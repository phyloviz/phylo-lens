# PhyloLens evaluation

This directory contains reproducible RQ1–RQ4 evaluation harnesses. It does not
contain external-tool comparisons or thesis-result claims.

## Final RQ1 released-OCI harness

`phylo_lens_eval.rq1_final` is the immutable final RQ1 runner.  It is separate
from the legacy local-import runner: final observations exclusively call the
released public OCI service API and use the frozen 15-condition input matrix
in `config/rq1-final-oci-v020.json`.  Run it only from a clean, committed
evaluation checkout and a clean benchmark checkout at the approved Thesis
commit:

```bash
PYTHONPATH=eval/src .venv/bin/python -m phylo_lens_eval.rq1_final \
  --run-id thesis-final-rq1-v020-001 \
  --thesis-root /Users/goncalofrutuoso/Developer/Thesis
```

The command refuses any other run ID, an existing raw-result directory, a
dirty worktree, changed product source, input checksum mismatch, or a Thesis
commit other than the recorded provenance.  It does not retry observations.
After a completed campaign, generate deterministic derived artifacts and audit
them from the raw directory with `phylo_lens_eval.rq1_final_audit`.

RQ4 measures warm-session interactive responsiveness after the normal public
client bootstrap. Every operation uses a fresh server/browser process but calls
the public `PhyloLensView.load()` during unmeasured setup; preparation and first
load therefore remain outside the RQ4 timing region and are covered by RQ1.

## RQ4 interactive responsiveness

RQ4 measures `viewport_navigation`, `cluster_expand`, and `cluster_collapse`
after normal public bootstrap. Its server-state policy is
`fresh_process_public_bootstrap_warm_session`: every repetition has a fresh
server and browser, calls public `PhyloLensView.load()` during unmeasured setup,
waits for the initial snapshot observer and configured quiescence, then records
`t0` immediately before one real Playwright interaction. `t1` and `t2` are the
first relevant request's browser `PerformanceResourceTiming` dispatch and
response-end timestamps; `t3` is entry to the internal snapshot observer, and
`t4` is the second subsequent animation frame. All five use the page's
`performance.now()` clock domain. Collapse is client-local, so its HTTP
components are explicitly `not_applicable`. The policy intentionally replaced the withdrawn pre-existing-
layout startup rule because public `load()` intentionally prepares the graph.

Build the public package and evaluation page, then run the deterministic pilot:

```bash
(cd code/client && npm run build:lib)
(cd eval/browser && npm run build)
PYTHONPATH=eval/src:code/server/src python -m phylo_lens_eval.rq4 \
  --experiment rq4-interactive-pilot --warmups 0 --repetitions 1
```

The run retains fresh-process identity, input checksum, final layout identity
observed after bootstrap, observer and request traces, raw rAF intervals, and
per-repetition server/browser diagnostics. It is an implementation smoke/pilot,
not a final thesis run or claim about startup, preparation, cold first use, WAN
latency, or physical display scanout.

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
