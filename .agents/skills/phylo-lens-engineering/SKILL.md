---
name: phylo-lens-engineering
description: "Implement or review nontrivial PhyloLens features, algorithms, TypeScript state, and test changes. Verify reference semantics, preserve tree/MST scope, assess complexity, and keep changes behaviorally justified. Use for engineering work in this repository, not unrelated tasks."
---

# PhyloLens engineering

Scale this workflow to the change. Read the relevant sections of
[engineering references](references/engineering.md) before making structural,
algorithmic, typing, or testing decisions. Cite the specific concept used and
explain its application; a book title alone is not evidence of a good design.

## Establish the behavior and its scope

- Treat fully labelled trees, MSTs, and their forest components as the product
  scope. Do not silently introduce phylogenetic-network support.
- Keep nLV distance connections as an overlay. The original MST/forest remains
  authoritative for branches, component membership, and layout springs. Overlay
  cycles do not authorize cyclic prepared datasets or phylogenetic-network
  support. Preserve core tree validation and existing branch interactions.
- Trace the current implementation and verify the requested reference behavior
  against primary documentation or source. Record the source version or file and
  relevant decision. Keep verified behavior separate from inference and proposals.
- Make examples of expected input/output concrete. Check distance units, threshold
  equality, tied distances, missing loci, equivalent profiles, and component
  identity when relevant. Do not turn a meeting example into a hardcoded rule.
- Preserve established documentation naming constraints. Record scientific
  decisions in simple terms and keep implementation detail out of ordinary UI help.

## Choose a proportionate design

- Reuse the existing algorithm and state owners when their invariants fit. Before
  adding an index, adapter, module, or configuration option, identify the concrete
  work or complexity it removes. Prefer information hiding over pass-through layers.
- For a substantial design decision, compare a simpler viable alternative and
  explain why the chosen approach earns its cost. Do not require a formal design
  exercise for a small local edit.
- State time and space costs for the affected path using defined quantities such
  as nodes, edges, loci, and expanded groups. Include repeated work inside loops,
  sorting, data copies, index construction, and worst-case candidate generation.
- Use appropriate adjacency maps, sets, traversal indexes, or union-find when they
  materially improve the operation. Do not add caches without a clear owner and
  invalidation rule. Separate bounded memory/output from bounded running time.
- Measure representative workloads when making a performance claim. Book-based
  reasoning supports an algorithm choice; it does not establish measured latency.

## Express state and boundaries clearly

- Model mutually exclusive event/state cases with discriminated unions and explicit
  narrowing. Prefer a readable switch for multi-case transitions over nested
  conditional expressions; retain simple conditionals when they are clearer.
- Choose type aliases or interfaces for the needed semantics and repository
  conventions. Neither is universally better. Avoid rewriting declarations just
  to impose a preference.
- Validate external data at runtime and narrow unknown values. Do not substitute
  assertions, non-null assertions, or any for boundary validation.
- Make async ownership explicit: snapshot caller options when needed, prevent stale
  requests from replacing a newer dataset, and release instance-owned resources.
  Distinguish compile-time readonly from runtime freezing and deep immutability.

## Verify observable contracts

- Extend existing coverage where it proves the required behavior. Prefer results,
  state transitions, and user-visible outcomes to source-text inspections or tests
  that reproduce the implementation. Use interaction assertions when the interaction
  itself is a meaningful contract.
- Name doubles by their role: Fake for a working simplified implementation, Stub
  for canned responses, Spy for recorded calls, and Mock for expected interactions.
  Give stateful doubles fresh instance-owned state.
- Test database concurrency with real transactions on the relevant database engine.
  Bytecode inspection and SQLite cannot establish PostgreSQL locking behavior.
- In browser checks, wait for the relevant completion signal. A deliberate timed
  observation window is appropriate for proving continued stability; arbitrary
  readiness sleeps are not completion signals. Inspect visual states separately.
- For algorithm changes, use a small independent oracle or invariant and at least
  one relevant boundary/adversarial case. A large nonempty result is insufficient.
- Remove duplicate or empty-value checks only after confirming what behavior would
  remain covered. Run checks proportionate to the changed contracts; do not add
  tests solely to increase the suite count.

## Review the resulting change

- Inspect the complete diff, including new files. Remove unrelated formatting,
  unused helpers, repeated assertions, and abstractions without demonstrated value.
- Distinguish behavior-preserving refactoring from feature changes. Explain major
  changes in scope or file spread before implementation, and resolve conflicting
  requirements before dependent work. Continue independently authorized work.
- Report the changed behavior, verification, and remaining limitations. Separate
  local results from remote CI and whole-suite totals from newly added tests.
- Respect current commit/push instructions and existing PR organization. Preserve
  unrelated local work; a skill grants no additional publishing authorization.
