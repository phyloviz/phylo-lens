# PhyloLens Profiling Workbench

This folder is for development-time profiling, not final thesis evaluation.
The goal is to make performance work repeatable enough to trust while staying
lightweight enough to run during normal development.

Final evaluation scripts can later reuse the same metric names and dataset
families, but should live in a separate `evaluation/` folder with fixed
datasets, fixed machines, repeated trials, and statistical reporting.

## What This Measures

`server_profile.py` profiles the server/library path without HTTP or browser
noise:

- synthetic dataset generation
- LoD artifact construction
- base layout materialization
- prepared edge construction
- SQLite persistence/index preparation
- viewport reads across LoD tiers and bounds
- region reads
- node search
- SQLite query plans for the hot spatial-ish reads

It writes newline-delimited JSON (`.jsonl`) so results can be inspected with
standard tools, imported into notebooks, or compared in CI-style regression
checks.

## Folder Structure

```text
tools/profiling/
  README.md
  server_profile.py              # CLI entry point for server profiling
  compare_profiles.py            # CLI entry point for baseline/current compares
  phylo_profile/
    datasets.py                  # synthetic dataset families
    metrics.py                   # JSONL sink and timing/memory recorder
    server_runner.py             # prepare/layout/store/query profiling flow
    sqlite_inspection.py         # bounds, store-size, and query-plan helpers
    serialization.py             # payload-size serialization helpers
    comparison.py                # profile aggregation and comparison logic
    paths.py                     # checkout-local import bootstrap
  results/
    .gitignore                   # generated profiles stay local
```

Keep CLI scripts thin. New measurement behavior should usually land in
`phylo_profile/`, with the entry points only parsing flags and calling the
library code.

## Quick Start

From the repository root:

```bash
rtk python3 tools/profiling/server_profile.py --sizes 1000 5000 --shape balanced
```

Write results to a stable location:

```bash
rtk python3 tools/profiling/server_profile.py \
  --sizes 1000 5000 10000 \
  --shape balanced \
  --metadata-fields 8 \
  --warmups 1 \
  --repetitions 5 \
  --viewport-fractions 0.05 0.20 1.0 \
  --output tools/profiling/results/server_profile.jsonl
```

Capture a CPU profile for one run:

```bash
rtk python3 tools/profiling/server_profile.py \
  --sizes 10000 \
  --shape balanced \
  --cprofile tools/profiling/results/server_profile_10k.pstats
```

Compare two runs:

```bash
rtk python3 tools/profiling/compare_profiles.py \
  tools/profiling/results/baseline.jsonl \
  tools/profiling/results/current.jsonl \
  --fail-ratio 1.20
```

The comparison script reports median stage-time ratios for matching scenarios.
It is intentionally simple: it helps catch obvious development regressions
without pretending to replace a final benchmark protocol.

Use `--warmups` to absorb one-time import/cache effects and `--repetitions` to
generate multiple samples per scenario. The comparison tool groups matching
stage events and compares medians.

## Output Format

Each line is one metric event. The common fields are:

- `run_id`: shared UUID for one script invocation
- `timestamp_utc`: UTC timestamp
- `event`: metric kind, for example `stage`, `viewport`, `region`, `search`,
  `query_plan`, or `summary`
- `shape`, `target_nodes`, `actual_nodes`, `actual_edges`
- `duration_ms`: wall-clock duration for timed events
- `peak_kib_delta`: peak traced allocation delta when `tracemalloc` is enabled

Examples:

```json
{"event":"stage","stage":"prepare_lod_artifacts","duration_ms":42.1}
{"event":"viewport","lod_level":2,"bounds_fraction":0.2,"nodes":2500,"edges":2411}
{"event":"query_plan","query":"ready_nodes_bounds","detail":["SEARCH np USING INDEX ..."]}
```

## Development Use

Use this before changing algorithms or storage:

1. Run a baseline profile and save the JSONL file.
2. Make the code change.
3. Run the same command again.
4. Compare stage timings, viewport timings, node/edge counts, payload size, and
   query plans.

For repeated local checks, use the same command and write to different files:

```bash
rtk python3 tools/profiling/server_profile.py \
  --sizes 1000 5000 \
  --shape balanced \
  --warmups 1 \
  --repetitions 5 \
  --output tools/profiling/results/baseline.jsonl

rtk python3 tools/profiling/server_profile.py \
  --sizes 1000 5000 \
  --shape balanced \
  --warmups 1 \
  --repetitions 5 \
  --output tools/profiling/results/current.jsonl
```

The important question is not only "is total time lower?" It is also "which
stage moved?" A regression in metadata attachment, prepared edge reads, or
SQLite persistence can otherwise hide inside an apparently simple viewport
change.

## Relation To Thesis RQs

This maps naturally to the final evaluation plan:

- **RQ1 - Server-side scalability:** use stage events for preprocessing,
  layout, LoD creation, persistence/indexing, output size, and memory.
- **RQ2 - Client-side scalability:** add a browser harness later around visible
  nodes, visible edges, visible triangles, rendered primitives, memory, and
  initial visualization latency.
- **RQ3 - Triangle aggregation ablation:** run the same datasets and viewport
  sequences with LoD disabled versus enabled with triangle representatives.
- **RQ4 - Interactive exploration:** use a browser/Playwright harness with
  scripted pan, zoom, region selection, and expand/collapse sequences, measuring
  request latency, client sync time, render time, long tasks, and frame rate.

## Notes

- This folder intentionally has no extra runtime dependencies.
- The script uses direct Python calls rather than HTTP so server algorithmic
  cost is visible.
- SQLite B-tree coordinate indexes are profiled as implemented today. If an
  R-Tree or PostGIS backend is added later, keep the same metrics and compare
  backend variants rather than changing the measurement vocabulary.
