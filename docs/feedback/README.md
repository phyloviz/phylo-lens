# Researcher feedback delivery backlog

Source: researcher feedback supplied by the project maintainer, 2026-09-17.
All ten work items are required; priority determines delivery order, not scope.
The researcher supplied typing and ancillary files on 2026-09-17. Keep them
outside the repository; use the local audit command below. Existing Newick
fixtures and synthetic typing fixtures remain suitable for public regressions. Do not claim PHYLOViZ Online parity
until the same input, settings and expected distances are recorded.

## Delivery order

1. Missing-locus policy and reference distances (01).
2. Explicit isolate/profile membership (02), then pies (03) and search (04).
3. Navigation (05) and persistent expansion/gestures (06), independently of 01–04.
4. Initial colors (07), configurable Other (08), publication export (09), layout/group dragging (10).

Use focused PRs referencing the matching issue. A cross-cutting data-model change
must include persistence, wire contracts, public API and migration/cache behavior.
Do not implement profile equivalence as a rendering-only merge or as LoD state.
Do not equate a zero-length Newick branch with identical typing profiles.

## Work items

- [01: [P0] Define missing-locus policy and verify typing distances](01.md)
- [02: [P0] Represent equivalent typing profiles as one node with isolate membership](02.md)
- [03: [P1] Preserve isolate distributions in pies and define multi-field semantics](03.md)
- [04: [P1] Find every isolate ID and reliably navigate to its profile](04.md)
- [05: [P1] Stabilize navigation on large trees with distance labels enabled](05.md)
- [06: [P1] Separate zoom gestures from cluster expansion and preserve explicit expansion](06.md)
- [07: [P2] Make initial node colors explicit and consistent](07.md)
- [08: [P2] Let users choose categories grouped into Other](08.md)
- [09: [P2] Export publication figures with controllable edge-distance labels](09.md)
- [10: [P2] Improve layout readability and support dragging branches or groups](10.md)

## Validation and closure

Each issue records reproduction, root cause, acceptance evidence and linked PRs.
Use hand-checkable synthetic profiles for numerical correctness, real pinned
PhyloLib for integration, existing large Newicks for interaction/performance,
and a final researcher walkthrough for usability. Store no researcher data in
the repository without permission. Do not close the umbrella while required
criteria remain open; automated tests alone do not prove the reported UI fixed.

Tracking issue: https://github.com/phyloviz/phylo-lens/issues/19

## Current progress — 2026-09-17

- Issues #9–#18 created; umbrella #19 tracks all required work.
- 01 / #9: initial implementation and synthetic regression suite prepared
  locally; pinned-runtime and PHYLOViZ Online verification remain outstanding.
- 02–10: open. No issue is being treated as resolved by the first change.
- Server suite: 193 tests passed (18 new). No browser behavior has changed.

## Reference dataset received — 2026-09-17

The supplied reference page reports core analysis with missing-data threshold 0.
Local preprocessing agrees with its retained profile width and unique-profile
count. This confirms the intended missing-locus policy, not all numerical edge
distances or the current PhyloLens rendering. Local metadata IDs match the typing
IDs exactly, with no duplicate or slug-colliding IDs. Grouping and pies remain
implementation work; the real input includes a mixed-country profile group.

Run the aggregate-only audit without copying research data into the repository:

```sh
.venv/bin/python scripts/audit-typing-dataset.py /path/to/profiles.tsv /path/to/metadata.tsv --join-column FILE
```

The command records file fingerprints, retained/excluded locus counts, expected
profile multiplicities and join coverage. It prints no isolate IDs or metadata
values. The researcher share URL and raw files are not included in public issues.
Full distance-matrix comparison and pinned-PhyloLib execution remain open.

## Grouping implementation — 2026-09-17

Equivalent typing profiles now contract after the PhyloLib tree calculation.
Original IDs and per-isolate metadata persist in `profile_isolates` independently
of LoD, are returned on individual-profile viewport/region nodes, and resolve via
server-side search. Default node area is proportional to isolate count, including
the demo's linear profile-count mapping. Per-isolate rows preserve multi-field
pie correlations. Duplicate/ambiguous normalized IDs and repeated ancillary rows
for one typing isolate are rejected explicitly; all-identical profiles need no Java.

Validation: 205 server tests and 170 client tests passed; library build, lint and
format checks passed. SQLite/Graphviz/API were exercised on the supplied real
input with the pinned PhyloLib JAR, including search for every original ID and
conservation of the mixed-country profile counts. A temporary PostgreSQL instance
passed synthetic persistence, viewport, search and cleanup checks. Research files
and the share URL remain outside the repository.

Every computed edge agrees with independently counted Hamming distance on the
retained loci. The maximum edge differs from the online reference, so full
PHYLOViZ Online distance/topology parity remains open in #9. Browser visual
acceptance and the broader interaction backlog remain separate work.
