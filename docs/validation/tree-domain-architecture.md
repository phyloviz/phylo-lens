# Tree domain and module ownership — 2026-11-15

## Scope and compatibility

The canonical topology is a nonempty forest of fully labelled trees, MSTs, or
their components. Standard goeBURST and distance cutoffs may produce several
trees. Distance connections remain a display overlay; they cannot change the
forest used for branches, component membership, or layout springs.

Newick still accepts unnamed internal junctions and assigns deterministic
structural IDs. This compatibility was explicitly retained; generated IDs do not
turn a structural junction into an observed isolate. Renderer snapshots and
Graphology remain general graph representations, and `/api/graph/*` routes and
package-root exports retain their existing names.

The historical `allow_self_loops` option accepts only false. True now fails at
request validation rather than promising a topology that preparation would later
reject. No database schema or wire-field renaming is required.

## Responsibilities and decisions

- `domain/dataset.py` defines canonical datasets and validates topology during
  construction, copying, and persisted-payload decoding. Shared adjacency and
  iterative DFS indexing live in `domain/tree_index.py`. This replaces the split
  contract where cyclic datasets could survive construction until LoD indexing.
- `repository/layout_repository.py` names the persistence contract used by
  application services. SQLite and PostgreSQL implementations keep ownership of
  database operations and transactions.
- `RootedTypingForest` exposes one roots tuple for both inference modes. It
  replaces the redundant single-root/optional-component-roots representation.
- `prepare_dataset_ancillary` owns joining, coercion, isolate preservation, and
  summary derivation. Ingestion consumes its result and no longer imports private
  parsing/aggregation helpers. Input preflight remains available before expensive
  PhyloLib work, preserving error timing for reserved fields.
- Client transport modules are grouped by operation under `services/graph/`.
  Each operation colocates its DTOs, runtime guards, mappings, and service call;
  related DTOs share one file. Internal paths change; wire fields and exported
  public APIs do not.
- `ViewportRequests` owns request generations, abort controllers, pending reads,
  and focus cancellation. `TreePanels` owns active and saved interaction state
  plus switch ownership. The coordinator keeps snapshot composition and renderer
  application; unmounting cancels requests and releases saved panels.

The simpler alternative was to update names alone. That would retain delayed
forest validation, callers coupled to ancillary internals, and scattered async
ownership. These changes apply the [engineering references](../../.agents/skills/phylo-lens-engineering/references/engineering.md)
specifically: Ousterhout's information hiding gives ancillary and lifecycle
modules substantive ownership; Fowler's Split Phase separates source/observation
preparation from layout and display; Goldberg's runtime-boundary guidance makes
the validated forest contract depend on checks rather than a type assertion.
The existing workbench discriminated union, renderer adapter, and server/client
computation boundary remain useful and are retained.

## Cost and verification

For V canonical nodes and E tree edges, adjacency validation and forest indexing
each take O(V+E) time and space. Dataset copying repeats validation, as it already
did for root/component checks; this change does not introduce an index cache.
LoD still sorts adjacency in O(sum d(v) log d(v)) time for deterministic traversal.
Ancillary extraction retains the existing joins, coercion, and aggregation loops;
it does not change their asymptotic cost. Transport colocation changes imports,
with no additional runtime processing. Request bookkeeping is O(1) per read.
Saved panels retain camera/fold/expansion state, without retaining viewport
payloads or workers; memory tracks saved interaction state and component count.
No latency improvement is claimed without measurement.

Regression coverage checks the forest boundary through construction, copying,
and decoding; preserves ancillary values and duplicate-isolate membership;
and exercises camera requests, cancellation, focus, panel switching, expansion,
ancillary replacement, and overlay isolation through existing observable tests.
