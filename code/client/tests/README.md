# Client tests

Run `npm test` from `code/client`. It checks the test types before running Vitest.
The compile-time checks in `immutability.test-d.ts` fail if readonly contracts or
the separation between DTOs and application models are weakened.

Test observable behavior: state transitions, data ownership, stale requests,
filtering, ancillary distributions and renderer lifecycle. Keep DTO fixtures in
service tests; application tests use camelCase models and branded identifiers.
Use typed mocks for the methods a collaborator actually needs.

`freezeInput` is for small, plain test fixtures. It helps detect accidental writes
to reducer inputs and graph calculations. It does not imply that production
graphs should be recursively frozen.

Browser smoke scripts use the Playwright dependency in `eval/browser`. Install
that project's dependencies and Chromium before running the scripts. For example:

```sh
node tests/browser/elasticMotion.mjs
node tests/browser/viewportReadability.mjs
node tests/browser/visualStability.mjs
```

`REQUIREMENTS_API_URL=http://127.0.0.1:8128 node tests/browser/distanceOperations.mjs`
uses an isolated live service to exercise decimal, equal and zero cutoff values,
forest tabs, isolated nodes, the exported cutoff caption and restoring the
original tree. CI runs it with a temporary service and store.

The same sequence also checks exact Newick path connections, blue styling,
rejected partial results, manual folds, control width and exported metric
captions. Independent server tests compare centroid radius queries with tree
traversals and allelic block candidates with full Hamming distances, including
the repository's missing-locus/equivalent-profile fixture.

`visualStability.mjs` uses real Sigma rendering and a real layout worker with
controlled coarse/detailed snapshots. It checks default aggregate size bounds,
actual footprint accounting, stationary cameras with automatic motion on/off,
continuous wheel navigation, unchanged paused positions and unchanged edge
endpoints/distances/widths. It requires no API service. `STABILITY_REPORT` can
save its diagnostic JSON.

`node tests/browser/meetingRequirements.mjs` verifies manual collapse/expand,
distance-label intervals, grayscale edges, palette reset and lifecycle, removal
of the redundant node selector, and real pointer-driven branch dragging against
the product UI. Start a local API service first; `REQUIREMENTS_API_URL` defaults
to `http://127.0.0.1:8128`. Use an isolated service data directory. The script
creates and closes its own Vite server and browser, with a disposable dependency
cache. It writes `phylo-lens-manual-branch.png` and
`phylo-lens-sidebar-controls.png` in the system temporary directory, or
`phylo-lens-requirements-failure.png` when a scenario fails.

The same browser sequence checks Enter-to-search without reloading the dataset,
selected-node actions after search, independent display checkboxes, invalid
distance intervals, numeric size-field choices and both scales, a real PNG
download, and horizontal fit at 1440, 768, 390 and 320 pixels. These are functional
and layout checks; they do not measure task completion time or discoverability
with users. The Vite cache is separate from the development preview.

The sequence checks the group legend, exact hover/inspector node counts and the
unavailable whole-branch isolate total. Unit tests separately protect known zero
versus missing isolate counts, structural-junction summary styles, and wrapping
publication captions without resizing graph content. These checks do not replace
the [researcher walkthrough](../../../docs/validation/researcher-walkthrough.md).

Task navigation preserves files and settings, and a successful load opens Explore.
The browser sequence also exercises keyboard tab navigation, contextual inspector
selection, canvas resizing when the inspector closes, and export-dialog focus
containment, Escape, and return to its trigger.

The navigation and zoom fixtures also need a running graph service and a Newick
fixture. `tests/browser/tsconfig.json` checks these browser fixtures separately.

The meeting sequence also loads a 4,095-node binary tree with a custom component
limit, folds its root from a partial LoD slice, and verifies that a bounded camera
request still occurs while folded. Expanding the marker restores the current
slice without fetching the whole tree.
