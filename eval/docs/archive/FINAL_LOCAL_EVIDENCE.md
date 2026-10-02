# Final local evidence against PR #39

> Historical protocol/document. For the current campaign use [eval/README.md](../../README.md).

This document records the historical clean-PR39 campaign. For the current
working-source campaign, warm-ups, source fingerprints, preparation CPU phases
and canonical unversioned entrypoints, use [CURRENT_EVALUATION.md](../../CURRENT_EVALUATION.md).
The historical commands below retain their original provenance requirements.

Use `scripts/run_final_local_evidence.py` for the final RQ2/RQ4 campaign. It
supersedes the earlier development RQ4 membership-rank experiment in
`run_local_rq34.py`. Earlier observations remain historical diagnostics.

The product is the clean checkout at
`2a315171ece6812fdee7c8f87aba825eca183451`; publishing is unnecessary.
The script verifies the commit, absence of tracked product changes and source
Newick SHA256 before launching. Use an unused run ID; existing output directories
are never overwritten. Browser dependencies and headed Playwright Chromium must
already be installed. Build the selected product library and evaluation page:

```sh
rtk proxy npm --prefix /Users/goncalofrutuoso/.codex/worktrees/viewport-representation-lod/phylo-lens/code/client run build:lib
rtk proxy env PHYLO_LENS_EVAL_PRODUCT_ROOT=/Users/goncalofrutuoso/.codex/worktrees/viewport-representation-lod/phylo-lens npm --prefix eval/browser run build
rtk proxy .venv/bin/python scripts/run_final_local_evidence.py \
  --product-root /Users/goncalofrutuoso/.codex/worktrees/viewport-representation-lod/phylo-lens \
  --dataset /Users/goncalofrutuoso/Developer/Thesis/data/salmonella/fullmst/tree_fullmst_100000.nwk \
  --layout-dir /Users/goncalofrutuoso/Developer/phylo-lens/eval/results/archive/historical-local/local-pr39-fullmst100k-20261002/prepared-layout \
  --run-id UNIQUE-RUN-ID
rtk proxy .venv/bin/python scripts/audit_final_local_evidence.py \
  eval/results/local/UNIQUE-RUN-ID
```

`--smoke` uses one warm-up plus one observation per RQ2 condition and one per
RQ4 scenario. `--campaign rq2`, `integrated`, or `rq4` restricts a diagnostic run;
the final complete campaign uses the default `all`.

To replace only the medium RQ4 target with the logarithmic geometric-midpoint
selection while retaining all other observations, use:

```sh
rtk proxy .venv/bin/python scripts/rerun_medium_evidence.py \
  --previous-run eval/results/archive/diagnostics/final-pr39-rq2-rq4-20261002-b \
  --run-id UNIQUE-MEDIUM-RERUN-ID
```

This prints the selected cluster first, runs exactly seven `expand-medium` and
seven `collapse-medium` observations with the saved browser bundle and unchanged
instrumentation, and writes a new combined report/summary/audit. Other raw
observations remain referenced in the previous run. `medium-rerun.json` records
the old/new targets and hashes every file in the previous run to verify that it
remains unchanged. RQ2, navigation, small and large scenarios are not rerun.

## Protocol boundaries

RQ2 replay retains the seven existing fixture definitions: five node-and-edge
fixtures and two controlled cluster-rendering conditions. Each gets one warm-up
and five measured observations, each in a fresh headed browser/context. First
visualization starts immediately before public `view.load()`, records its
resolution, and ends after two animation-frame callbacks. This includes replay
HTTP/bootstrap work. JavaScript heap is sampled through CDP after view creation
and 100 ms after that boundary, without forced garbage collection. Frame pacing
uses the existing separate drag/wheel stress window. For PR #39, after heap
sampling, public `setKeepExpanded(true)`, a 600 ms setup wait and `expandAll()` pin the one-level
replay snapshot; completion is checked and a 350 ms wait precedes stress sampling. Setup requests
must return the identical fixture and no request may occur during the measured
stress window. This evaluation setup accommodates the new adaptive viewport
controller without changing product behavior or the measured initial load.

The fixture protocol's `total_primitive_count` is **nodes + edges + triangular
node glyphs**. Triangular glyphs are already nodes, so that weighted protocol
count must not be called the number of distinct graph elements. The 10k
node-and-edge fixture has 5,000 + 4,999 = 9,999 graph elements. The corresponding
cluster control has 3,333 + 3,332 + 3,333 = 9,998 protocol units, but 6,665 distinct
node/edge elements. Labels remain disabled in these deterministic fixtures.

Integrated RQ2 uses four prescribed viewport windows from the retained
Salmonella layout. The first viewport request is replaced, in the evaluation
fetch wrapper only, with a normal adaptive query: preferred level derived from
nominal camera ratio, default 960×640 CSS pixel target (1,066 representations),
unexpanded selection bounds and 50% padding on each side for retrieval. No
effective level or node limit is forced. The real PR #39 server performs level
selection and retrieval. Preparation is mocked as ready to reuse the prepared
layout; response content is not mocked. The measurement is a fresh view load of
that real viewport response, not a native navigation trace or whole-tree render.
It preserves the load-to-two-frame first-visualization boundary; frame pacing
is sampled over that same load window. Heap sampling retains the CDP mechanism
and 100 ms post-boundary wait. These frames are not directly comparable with
replay's separate drag/wheel stress frames. Later automatic camera/viewport
activity is outside the measured boundary.

RQ4 discovers non-singleton clusters across all prepared levels, uses recorded
quantiles and separation constraints, and prints the three distinct targets
before running. For expansion/collapse, an evaluation-only initial query loads
the selected level around the target's attachment coordinates. Public
`setKeepExpanded(true)` pins that level; setup finishes before measurement.
The recorded diagnostics must contain the intended collapsed cluster and count.
A trusted native click on an evaluation button calls the public API for that
ID. It measures the API action, not the time to search for or select a cluster.
Collapse pre-expands the target outside measurement. Navigation retains the
native wheel and normal adaptive selection, without the pinned setup.

RQ4 interaction/display latency runs from trusted capture-phase native input
through the applicable newer snapshot to two animation-frame callbacks. The
frame wait begins inside the snapshot observer, avoiding Playwright polling
delay. The sampler is reset at native input and excludes intervals ending after
the measured boundary. Its initial capture-to-frame gap is partial; the audit
retains it separately and excludes it from consecutive-frame statistics.
Latency does not establish that subsequent animations,
network requests or rendering have become idle. Collapses commonly use local
state and have no HTTP phase.

Evaluation-only wrappers in `local_eval_server.py` retain production operations
and add Server-Timing headers for repository count/read operations (SQL plus
Python row processing), response-model construction and Pydantic JSON-byte
serialization. The enclosing FastAPI schema-serialization interval includes
validation and JSON serialization and therefore overlaps the JSON interval.
Do not add those intervals together. Browser input, fetch invocation, response
end and snapshot timestamps share `performance.now()`; server durations use
server-local `perf_counter()`. No cross-clock subtraction or separate network
transfer estimate is made. Native navigation retains schedules/fires for 60 ms
and 120 ms timers as diagnostic evidence; canceled timers have no fire time.

All campaigns report frame interval median, nearest-rank p95, maximum and count/
proportion strictly above 50 ms. This threshold flags conspicuous frame gaps
for diagnosis, and is not a universal perceptual threshold or an interaction
latency budget. Raw samples and their exact window are retained.

## Outputs and limits

The result directory contains source snapshots/hashes, manifest, target rule and
evidence, integrated queries and expected counts, raw controls/results/logs,
incremental observations and summaries, independent audit and `REPORT.md`.
Localhost client/server eliminates internet variability but does not isolate
browser costs in the integrated campaign. The replay campaign provides that
separate evidence. GPU/host, browser, heap and sample-count limitations belong
in the thesis. Existing RQ1, external comparisons, thesis text and publication
figures are not part of this campaign.

The viewport probes are a finite search, not a proof of a global maximum.
10k/20k returned-node responses were not obtained for the chosen default
viewport; no artificial effective-level forcing is used to fill that gap.
EnteroBase scheme/version, download date, original profile count and locus count
remain explicit TODOs unless independently established from source provenance.
