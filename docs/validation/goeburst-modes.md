# Typing inference modes — 2026-11-14

## Reference behavior

Verified against the repository-pinned PhyloLib 1.0.1 JAR, SHA-256
`3bf2020ec474a177682ccb2dc1b5b5c71f39e16f4e2012e24cfb8cbbaa673503`.
The executable's `algorithm goeburst` command reports the default `--lvs=3`.
Inspection of `pt.ist.phylolib.command.algorithm.goeburst.GoeBURST`
(`configureRequiredDistanceScope` and `processImpl`) and direct CLI runs confirm:

- `--lvs=n` includes positive Hamming distances at or below n, with no fixed
  three-level maximum. More distant profiles remain in separate components.
- Zero-distance links are skipped by standard goeBURST. Running duplicate
  profiles directly can give a duplicate a nonzero edge to a different profile.
- `goeburstfullmst` continues to provide the existing all-level spanning tree.

PhyloLens therefore runs standard goeBURST on one representative per distinct
profile, in first-occurrence order. It restores original isolates as zero-length
spokes at the ingest boundary, where the existing contraction and ancillary join
retain all isolate observations on the canonical profile node. Full MST retains
its existing duplicate-profile input behavior. This is a required adaptation to
standard goeBURST's zero-distance behavior, not a claim of parity with another
PHYLOViZ implementation's tie-breaking or frequency weighting.

Every prepared component gets one technical root, ranked using distinct-profile
LV counts through the selected level, then first input occurrence. Full MST
retains its ranking through all observed levels. Cycles and incomplete membership
remain invalid; inference-level limits do not introduce graph-network support.
Distance overlays remain separate and do not join prepared components.

## Design and cost

The existing PhyloLib boundary owns both modes. Cutting a Full MST after inference
was rejected because standard goeBURST has its own bounded LV tie-breaking;
calling its actual CLI command preserves that behavior.

The [engineering reference's TypeScript union and runtime-boundary concepts](../../.agents/skills/phylo-lens-engineering/references/engineering.md)
apply directly: the algorithm discriminates the option cases, so Full MST has
no nLV field, while standard goeBURST defaults it to 3. Runtime request and
response checks enforce those cases. Submitted options are copied before async
work, and the client requires the server to confirm explicitly selected settings.

For N original isolates, U distinct profiles, L retained loci, and K the selected
level capped at L, standard inference writes a U-profile matrix rather than an
N-profile matrix. Hamming computation remains O(U²L), with O(U²) matrix storage;
this change does not make pair-distance generation subquadratic. PhyloLib's
standard algorithm scans O(U²) matrix entries and allocates O(UK) LV counts;
tie comparisons may inspect K entries, giving an O(U²K) worst-case bound.
The Python root pass reads the matrix once in O(U²) time, keeps at most
O(U min(U,L)) distance-count entries, and ranks roots in O(UK) time.
Forest validation and root traversal take O(U+E) time and space for E inferred
edges. Representative preparation and isolate restoration add O(NL) work and
storage for profile content plus O(N) membership/spoke storage; sorting isolate
members adds O(N log N) work in the worst case. No measured
latency improvement is claimed.

## Verification

`code/server/tests/test_goeburst_options.py` checks validation, exact CLI option
forwarding, inclusive level boundaries, multiple components, per-component roots,
duplicate-isolate ancillary observations, persistence round trips, and cycle
rejection. With `PHYLO_LENS_PHYLOLIB_JAR` set, it also executes both real algorithms
against a hand-calculated four-locus distance oracle at levels 1, 3, and 4.
Client tests cover control visibility, invalid levels, source switching, option
forwarding, async option ownership, and rejection of unconfirmed inference settings.

```sh
PHYLO_LENS_PHYLOLIB_JAR=/path/to/pinned/phylolib.jar \
  .venv/bin/pytest code/server/tests/test_goeburst_options.py -q
```
