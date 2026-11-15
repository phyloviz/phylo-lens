# Typing pipeline simplicity — 2026-11-15

This cleanup follows the restored forest-domain architecture and preserves the
newer client confirmation of typing settings. It changes preparation internals,
not inference modes, public request shapes, or dataset identity rules.

## Decisions

- `RootedTypingForest` returns the canonical profile forest and technical roots.
  Original isolate identities belong to profile membership, so ancillary joining
  receives explicit join IDs instead of requiring synthetic zero-length spokes.
  Ingestion constructs final domain nodes and edges once.
- Immutable `PreparedTypingProfiles` owns a read-only membership result, derived
  lazily once per instance. Its immutable rows require no invalidation. Laziness
  preserves standalone audit callers' ability to inspect input before requesting
  canonical membership. An eager result was simpler locally but changed that
  validation boundary; a global cache would add unnecessary lifecycle concerns.
- Root ranking reads either the original-isolate matrix or the representative
  matrix explicitly. Both use original isolate order for the final tie, including
  when the canonical representative appears later than another group member.
- When an allelic threshold covers all retained loci, every within-component
  pair qualifies. Enumerate those pairs directly and still compute exact distances;
  building a block index would add work without filtering any candidates.
- Remove the viewport invalidation forwarding method and duplicate default-mode
  dispatch. Their existing owners already implement the whole operation.

These apply information hiding and removal of middlemen from the
[engineering references](../../.agents/skills/phylo-lens-engineering/references/engineering.md).
They do not replace PhyloLib inference or introduce another algorithm framework.

## Cost and direct comparison

Let N be original isolates, U distinct profiles, E inferred edges, and L retained
loci. Membership grouping takes O(NL + N log N) worst-case time and O(N) extra
membership storage, once per immutable input. The already-retained rows take
O(NL) space. Final domain construction takes O(U log U + E) time and O(U+E)
objects, without a discarded original-isolate graph. PhyloLib's quadratic matrix
costs remain unchanged; see [typing modes](goeburst-modes.md).

For P overlay profiles, the all-loci threshold path takes O(P log P + P²L)
worst-case time, including sorting and exact distances. It retains O(P) sorted IDs
and streams results. Skipped cross-component pairs still cost O(P²) checks in the
worst case; output limits do not establish a subquadratic running-time bound.
Below that threshold the existing exact block-filter path remains in use.

A local probe compared the restored architecture commit `160c1ba` with this
cleanup, using the pinned real PhyloLib JAR. All ten cases produced identical
dataset JSON (excluding generation timestamps), layout versions, and warnings:
implicit and explicit Full MST; nLV 1, 3, 4 and 100; a distance cutoff; one unique
profile with duplicate isolates; complete-locus deletion; and anonymous-junction
Newick forest input. The typing fixture contained five isolates and four distinct
four-locus profiles, with per-isolate ancillary observations.

| Counted work on that typing fixture | Before | After |
| --- | ---: | ---: |
| Constructed domain nodes | 9 | 4 |
| Constructed domain edges, nLV 3 | 5 | 2 |
| Constructed domain edges, Full MST | 7 | 3 |
| Membership grouping passes, nLV 3 | 5 | 1 |
| Membership grouping passes, Full MST | 2 | 1 |
| Block-index tuple slices, four profiles/four loci/threshold 4 | 16 | 0 |

The final allelic pairs and distances also matched exactly. These are operation
counts on small fixtures, not measured latency or scalability claims.

## Regression checks

Server coverage checks immutable membership, original-order root ties with a
representative-only matrix, exact Hamming results and ordering at and above the
locus count, preserved ancillary joins and saved identities, finite inference
edges, and suppression of internal Newick serialization warnings in bounded
inference. Non-finite typing edges remain rejected at the inference boundary
without constructing a discarded domain graph.

The real-JAR mode test checks actual inferred edges against an independent
Hamming/component oracle. Client tests cover request invalidation and stale
responses after the forwarding-method removal. The full server, client, and
evaluation suites were run; PostgreSQL-only checks require their separate test
database and were not exercised locally.
