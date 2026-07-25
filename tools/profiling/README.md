# Server profiling workbench

`tools/profiling` provides repeatable development-time measurements for server
hot paths. It is intended for regression diagnosis and algorithm exploration.
It is not the final thesis evaluation protocol.

The final `eval/` workflow should fix datasets, machines, software versions,
repetitions, statistical analysis, and reporting independently from this
workbench.

## Scope

`server_profile.py` calls server modules directly, without HTTP or browser cost.
It measures:

- synthetic dataset generation;
- distance-tier and LoD artifact construction;
- global layout materialization;
- prepared-edge construction;
- SQLite persistence and indexes;
- viewport reads across tiers and bounds;
- region reads;
- node search;
- serialized payload size;
- SQLite query plans for selected hot reads.

This separation is useful when a regression must be attributed to preparation,
persistence, or query execution rather than network or renderer behavior.

## Structure

```text
tools/profiling/
  README.md
  server_profile.py
  compare_profiles.py
  phylo_profile/
    comparison.py
    datasets.py
    metrics.py
    paths.py
    serialization.py
    server_runner.py
    sqlite_inspection.py
  results/
    .gitignore
```

Entry-point scripts should remain thin. Dataset generation, measurement, and
comparison behavior belongs in `phylo_profile/`.

## Prerequisites

Install the server development environment first:

```bash
cd code/server
python -m pip install -e '.[test,dev]'
cd ../..
```

Graphviz must be available when profiling the production layout path.

## Basic run

```bash
python3 tools/profiling/server_profile.py \
  --sizes 1000 5000 \
  --shape balanced
```

A repeated run with explicit output:

```bash
python3 tools/profiling/server_profile.py \
  --sizes 1000 5000 10000 \
  --shape balanced \
  --metadata-fields 8 \
  --warmups 1 \
  --repetitions 5 \
  --viewport-fractions 0.05 0.20 1.0 \
  --output tools/profiling/results/server-profile.jsonl
```

Use `--lod-levels -1` to address the finest available tier. Other values are
explicit server LoD indexes.

## CPU profiling

```bash
python3 tools/profiling/server_profile.py \
  --sizes 10000 \
  --shape balanced \
  --cprofile tools/profiling/results/server-profile-10k.pstats
```

The command writes a `pstats` file and prints the top cumulative-time entries.

## Comparing two profiles

```bash
python3 tools/profiling/compare_profiles.py \
  tools/profiling/results/baseline.jsonl \
  tools/profiling/results/current.jsonl \
  --fail-ratio 1.20
```

The comparison groups matching stage events and reports median durations. With
`--fail-ratio`, the command exits non-zero when a shared stage exceeds the
specified ratio.

This is a regression signal, not a statistical conclusion. Review sample counts,
absolute duration, node/edge counts, payloads, and query plans before attributing
a performance change.

## Output format

Each JSONL line is one metric event. Common fields include:

| Field | Meaning |
| --- | --- |
| `run_id` | UUID shared by one invocation |
| `timestamp_utc` | Event timestamp |
| `event` | `stage`, `viewport`, `region`, `search`, `query_plan`, or `summary` |
| `shape` | Synthetic graph family |
| `target_nodes` | Requested synthetic size |
| `actual_nodes`, `actual_edges` | Generated graph size |
| `repetition` | Recorded repetition number |
| `duration_ms` | Wall-clock duration for timed events |
| `peak_kib_delta` | Traced allocation delta when available |

Example:

```json
{"event":"stage","stage":"prepare_lod_artifacts","duration_ms":42.1}
{"event":"viewport","lod_level":2,"bounds_fraction":0.2,"nodes":2500,"edges":2411}
{"event":"query_plan","query":"ready_nodes_bounds","detail":["SEARCH np USING INDEX ..."]}
```

Generated profiles remain under `tools/profiling/results/` and are ignored by
Git.

## Recommended development workflow

1. run a baseline with fixed arguments;
2. record the current commit and environment separately;
3. make one algorithmic or storage change;
4. rerun the exact command;
5. compare stage medians, memory, payloads, node/edge counts, and query plans;
6. confirm suspicious results with additional repetitions and a profiler.

Do not optimize only for total time. A change can move cost between layout,
metadata attachment, persistence, and viewport reads while leaving one aggregate
number apparently unchanged.

## Relationship to thesis evaluation

The metric vocabulary can inform the final evaluation, but final experiments
should add:

- real phylogenetic and typing datasets;
- controlled hardware and software versions;
- browser/network measurements;
- fixed warm-up and repetition policy;
- confidence intervals or other justified statistical summaries;
- explicit failure and timeout criteria;
- automatic figure and table generation.

Do not cite development-profile results as final evidence unless they were
produced under the documented evaluation protocol.
