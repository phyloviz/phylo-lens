# Current local evaluation — 2026-10-02

This campaign measures the current working source without publishing a package.
The base Git commit and package version are recorded, but **the product source
SHA-256 fingerprint and saved source files identify the measured implementation**.
Historical releases and observations keep their original identities. Thesis
prose is outside this task.

## Canonical entrypoints

- `eval/scripts/run_final_local_evidence.py --current-source`: RQ2 replay, integrated
  RQ2 and RQ4, using the real current client and localhost service.
- `eval/scripts/audit_final_local_evidence.py RUN`: independent temporal, membership,
  hierarchy, coordinate and weighted-edge validation; writes `REPORT.md`.
- `eval/scripts/run_local_rq34.py`: prepare and validate the canonical RQ3 hierarchy.
- `eval/scripts/run_preparation_evaluation.py --campaign rq1|external`: shared current
  server/preparation path, phase wall/CPU instrumentation and process-tree samples.
- `eval/scripts/audit_preparation_evaluation.py RUN`: raw-data reconciliation and
  derived tables for the preparation/visual campaign.

Version-suffixed duplicate runner sources are retained in the verified archive
`results/derived/legacy-release-runner-sources-20261002.zip`. Active MSAGL dataset
selection now uses `phylo_lens_eval.core.fullmst`; historical dataset registry
names do not identify a new product release. Historical raw measurements are
preserved. Compression inventories include decompressed SHA-256 verification;
generated SQLite archives can be restored with `gzip -dk FILE.gz`.
The validated 100k master was also compressed after its final audit to make room
for 200k. Restore `current-prepared-100k-20261002/prepared-layout/prepared_layout.sqlite3.gz`
before repeating RQ3/RQ4 or their database audit. Timing/summary/report files are
already readable without restoring it.

## RQ1: completed and independently audited

The user campaign `current-rq1-final-USER` completed and passed the independent
audit: 50 successful measured observations and 10 excluded warm-ups.
For reproduction, run from the repository root with a **new, unused run ID**,
without another benchmark running simultaneously:

```sh
rtk proxy .venv/bin/python eval/scripts/run_preparation_evaluation.py \
  --campaign rq1 --run-id YOUR-NEW-RUN-ID
rtk proxy .venv/bin/python eval/scripts/audit_preparation_evaluation.py \
  eval/results/local/YOUR-NEW-RUN-ID
```

Defaults: the ten retained Full-MST inputs (12,500–200,000 canonical nodes), one
excluded warm-up and five measured observations per size; fresh localhost
service and store per observation. Public POST→first observed ready, with 100 ms
polling, is the primary boundary. Startup and health checks are outside it.
The prepare deadline is 360 s; failure remains a failed observation.
The input read from disk is already available when the public operation begins.
This is preparation readiness, not a rendered frame.

Phase spans retain normalization, base layout, hierarchy, index and actual
`sfdp` subprocess wall/CPU time. A 20 ms sampler retains RSS, CPU counters and
thread counts for the service process tree. CPU-seconds/wall-seconds expresses
mean CPU equivalents; it does not establish which physical cores ran. Nested
spans overlap and must not be summed. The resource sampler covers its full
service lifecycle, including setup and cleanup; its peak RSS is not restricted
to the browser t0→visual window. Every observation inventories hashes and
sizes of generated persistence before removing it; `--keep-persistence` opts
into retaining large databases. Raw timing, resource samples, logs, input hashes
and source snapshots always remain. This avoids the historical tens-of-GB
duplication of generated layouts.

The native server uses the installed Graphviz, measured as 15.1.0, rather than
the historical OCI Graphviz 12.2.1. New RQ1 and external PhyloLens runs share this
path. Do not pool the new observations with old OCI timings or attribute a
cross-campaign difference to one algorithmic phase without matched evidence.
The runner now checks free space before setup and each observation (3 GiB at
200k, scaled down for smaller inputs). Resource-sampler failures invalidate the
observation rather than remaining an unnoticed background-thread exception.
These safety checks were added after the final external run; its saved harness
snapshots retain the actual measured revision and the same timing boundaries.
Keep extra room for OS/background writes when running RQ1; the storage guard
cannot reserve filesystem capacity.

## RQ2/RQ3/RQ4 boundaries

RQ2 replay: seven retained fixture conditions, one excluded warm-up and five
measurements each. Protocol units count nodes + edges + triangular glyphs; the
glyphs are already nodes. Thus the cluster control has fewer distinct graph
elements than the similarly named node/edge control. Report both counts.

Integrated RQ2: four prescribed viewport windows on the freshly prepared 100k
Full-MST tree, one warm-up and five measurements each. They use ordinary adaptive
selection parameters, including the CSS-area representation target and padded
retrieval bounds. The real server chooses the effective tier. They are fresh
view-load observations, not a natural navigation trajectory. Preparation alone
is reused/mock-ready; viewport response content is real. Both RQ2 load boundaries
end after two frame callbacks, which does not prove all animation is idle.

RQ3 validates every prepared tier: exact canonical-node partition, connected
multi-node pendant aggregates with one external edge, branch-preserving
refinement, explicit finest tier, canonical coordinates (exact persisted float
comparison, tolerance zero), and canonical quotient edges **including weights**.
The technical root orients hops; aggregate membership is not branch-length
clustering. These checks establish representation invariants, not a biological
interpretation of cluster membership or comparative layout quality.

RQ4: seven scenarios, one excluded warm-up and seven measured observations each,
each in a fresh browser/context. Fixed small=2 and large=3,796; medium minimizes
`abs(log(member_count / sqrt(2*3796)))`, ties by LoD then cluster ID: 88 members,
`lod_9_220085`, level 9. Target discovery, preparation and expansion setup are
outside the measured action. Input is trusted native capture. The selected
snapshot must have a newer sequence and a timestamp after that input. Navigation
also requires a post-input viewport response before the snapshot; setup snapshots
cannot satisfy the measured boundary. Two frame callbacks begin inside the
snapshot observer. The initial input→frame gap is separately retained and
excluded from consecutive-frame statistics.

Browser timestamps share `performance.now()`. Server-Timing durations use the
server clock; no cross-clock subtraction is made. SQL/read, response construction
and JSON serialization are retained; the enclosing schema interval overlaps
JSON time. Local collapses can legitimately have no HTTP phase. Timer diagnostics
record schedule/fire/cancel, so their role can be measured rather than inferred
from constants. Frame summaries retain median/p95/max, sample count and strictly
greater-than-50-ms gaps. The physical display refresh rate is not controlled.
The captured macOS display metadata identifies DELL P3425WE, 3440×1440 at a
nominal 100.00 Hz for this current campaign. This is recorded display-mode
metadata, not a physical refresh measurement or evidence about historical runs.

## External comparison and MSAGL

Phylotree.js `phylotree@2.6.0` and Taxonium `taxonium-component@2.1.24` use retained
native Newick wrappers and lock/SRI identities, copied into writable evaluation
directories. Dependencies are locally linked; no source dataset or upstream
package is downloaded. Fresh headed Chromium 140.0.7339.16 / Playwright 1.55.0,
1440×900 CSS pixels, scale factor 1, UTC/en-US and external-network blocking are
shared by the new three-tool campaign. The historical visual campaign used
Chromium 149; keep that distinction in comparisons.
The copied PhyloLens wrapper lock retains its historical npm dependency entry;
its saved Vite alias resolves to the current local client bundle instead. The
bundle hash, source fingerprint and alias establish the evaluated version;
the unused historical lock entry does not.

One warm-up + three measured observations per size, growing input order, no
hidden retries. Two consecutive all-measured-failure sizes stop the affected
tool; skipped larger sizes are not timeouts. Phylotree/Taxonium visual deadline
120 s, parent watchdog 165 s. PhyloLens parent watchdog is preparation deadline
+ 150 s, including its 120 s post-ready visual allowance and startup headroom.
First-visual boundaries begin with consuming an already supplied Newick string,
excluding source-file I/O and browser/server startup.
Final external evidence is consolidated in
`results/derived/current-external-combined-20261002/REPORT.md`: completed cells
up to 150k from the first raw run, and only 200k from the separate replacement
run. The original 200k warm-up hit ENOSPC before any measured observation;
its diagnostics remain, and both source runs passed independent audits.

- Phylotree: first post-trigger SVG signature change with positive dimensions
  and at least one path/line/circle/text mark. Its synchronous topology/label
  checks are inside the measured window.
- Taxonium: first frame after its exact empty-Deck loading overlay disappears;
  a same-callback, post-timestamp bitmap must show distributed tree geometry.
- PhyloLens protocol v2: first post-ready candidate frame with a nonuniform
  copied bitmap of visible Sigma **node/edge geometry** canvases, 64×48 samples.
  Label/hover/UI canvases cannot satisfy the predicate. Bitmap validation starts
  immediately after the timestamp. This replaces the old 16×16 `readPixels`
  predicate, which failed to observe already-rendered geometry. No idle or
  all-label-readability claim follows from this boundary.

Visual success and fidelity are separate: retain each adapter's identity and
topology status. Service counts alone do not prove full edge identity. Taxonium's
public wrapper lacks a stable full-node enumeration. Do not reinterpret these
limitations as verified biological equivalence.

MSAGLJS remains the pinned historical MDS preparation baseline, upstream commit
`db1ecbba39f46ca83aa90a87bad2012757e51f42`, not a first-visual baseline. Derived
paired metrics and exact provenance are in `EXTERNAL_COMPARISON_AUDIT_20261002.md`:
retain adapted-input→tile-ready total and **per-observation** `total_ms-parse_ms`.
The measured “parse” includes edge-list decoding and native graph construction;
Newick→edge-list adaptation and first rendered frame were not measured. Do not
call that historical total true Newick end-to-end or combine new adaptation
timings with old totals. The ~50.03 s construction phase at 87.5k stays visible.
The retained MSAGL adapter also generates new internal IDs and writes only
endpoint pairs, dropping Newick branch weights. Its baseline is therefore
topological MDS preparation, not evidence that weighted phylogenetic geometry
or all original labels are preserved. Current RQ3 separately checks canonical
edge weights and attachment coordinates exactly.

Input provenance TODOs remain explicit: EnteroBase scheme/version, download date,
original profile count and locus count cannot be recovered from the retained
Newick alone. Do not invent them to fill the thesis setup table.
