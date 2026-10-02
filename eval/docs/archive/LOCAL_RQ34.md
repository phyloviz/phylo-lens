# Local RQ3 and RQ4 without publishing a release

> Historical protocol/document. For the current campaign use [eval/README.md](../../README.md).

For the final thesis RQ2/RQ4 evidence, use [FINAL_LOCAL_EVIDENCE.md](FINAL_LOCAL_EVIDENCE.md).
The membership-rank RQ4 experiment documented below is historical development
evidence and is superseded by distinct targets across all prepared levels.

`scripts/run_local_rq34.py` evaluates source from a local product checkout. It
builds the client library and evaluation page locally and serves the SQLite API
on loopback. No registry image, npm publication, version bump, or Docker daemon
is needed. Results are written under `eval/results/local/<run-id>` and are
development evidence, separate from frozen release observations.

Run from the repository root with the existing development Python environment,
Graphviz, client/browser npm dependencies and Playwright Chromium installed:

```sh
rtk proxy .venv/bin/python scripts/run_local_rq34.py \
  --dataset ../Thesis/data/salmonella/fullmst/tree_fullmst_100000.nwk \
  --repetitions 7
```

By default the product comes from the current checkout, including its edits.
To measure a specific PR worktree, add `--product-root /absolute/path/to/checkout`.
The manifest records the product commit, tracked product diff hash, dataset hash,
built client bundle hash, Python, Graphviz and browser settings. The browser
results include Chromium version and actual GPU backend. The evaluation page's
Vite import resolves to the selected product's library; it does not require the
library to be published or copied into the main checkout.

Preparation is reusable when runtime/client changes do not change the current
dataset and layout fingerprint:

```sh
rtk proxy .venv/bin/python scripts/run_local_rq34.py \
  --dataset ../Thesis/data/salmonella/fullmst/tree_fullmst_100000.nwk \
  --layout-dir /absolute/path/to/previous/run/prepared-layout \
  --repetitions 7
```

Each invocation creates a new result directory, discovers the prepared tiers,
and revalidates them. It does not reuse old browser observations. Use
`--rq3-only` for structural checks without launching a browser. `--headless`
is supported for development diagnostics; headed runs on the same hardware
are preferable when comparing frame pacing. `--run-id` supplies a simple unique
directory name. Existing output directories are never overwritten. For a quick iteration on
navigation and the largest available aggregate, combine reuse with
`--repetitions 1 --scenario navigation --scenario expand-high --scenario collapse-high`.
The default still runs all seven scenarios with seven observations each.

## What is measured

RQ3 independently traverses the canonical source from its technical roots and
checks the persisted partitions at every selected hop cut. Checks include exact
coverage, declared membership counts, connectedness, one boundary edge per
multi-node pendant aggregate, attachment depth, nested refinement, representative
coordinates, quotient connectivity, the representation-count formula and
singleton finest detail. The retained SQLite database, cuts, materialization
counts and preparation stage timings accompany the evidence.

RQ4 runs native wheel navigation, then expansion/collapse for low, median and
high membership ranks, with a fresh browser/context for every observation.
Navigation retains normal adaptive selection. For expansion setup, public
`collapseAll()` followed by `setKeepExpanded(true)` pins the coarse tier before
targets are discovered from on-screen aggregate diagnostics. This prevents
automatic refinement from removing the aggregate before the measured click.
Collapse setup expands the selected aggregate outside the measured interval.

Timing starts at the trusted native input's capture-phase timestamp and ends
after the next applicable snapshot is applied and two animation frames pass.
This is a next-snapshot display boundary, not a claim that every subsequent
camera animation/network request has finished. Raw request traces, actual
response counts, input trust, snapshot sequence, baseline/operation frame
intervals, GPU evidence and a screenshot are retained. Response metadata is
observed from the JSON the product already parses, without an extra response
body read through Chromium's inspector cache.

Targets are local and discovered dynamically, not old `distance_cluster_*` IDs.
If only one aggregate is on-screen, all three rank labels refer to that same
target. Report that limitation; do not interpret those labels as distinct size
strata. Counts and fingerprints are recorded in every result. A viewport with
no aggregate cannot support an expansion case and is reported as a failure.

## Outputs and comparability

- `manifest.json`: source/data/build provenance and local protocol.
- `preparation-stages.json`, `layout.json`, `rq3.json`: preparation and structural evidence.
- `rq4/observations.json`: incremental per-observation results.
- `rq4/<scenario>/<repetition>/result.json`: full browser evidence, alongside
  control input, logs and screenshot.
- `summary.json`: success counts and per-scenario timing/target summaries.

The existing final release configurations and schemas remain unchanged. This
local protocol uses dynamic tiers/targets, unbounded normal queries, native
wheel input and pinned-coarse expansion setup. Its timings must not be merged
into an older frozen release's observation matrix without explicitly describing
those protocol differences. Failed/stopped runs remain diagnostic artifacts;
fresh run IDs identify subsequent corrected measurements.
