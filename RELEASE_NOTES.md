## Changes

- Add a forest overview and individual tree tabs, retaining each view's camera and expansion state with one active renderer.
- Keep layout positions stable during zoom. Relax explicitly, stop and retain the result, or opt into automatic relaxation. Dragged and relaxed positions are retained for the open dataset session.
- Organize the workspace into Explore, Appearance and Data sections, with contextual inspection, keyboard navigation and a focused export dialog.
- Correct linear and logarithmic node sizing and make nodes shrink on zoom-out.
- Support manual branch folding independently of automatic aggregation. Keep small forest components explicit using a configurable threshold, defaulting to 64 nodes.
- Add palette reset, prevent custom colors leaking across datasets, filter distance labels by an inclusive interval, and encode distance-weighted edges in grayscale.
- Fix interrupted and overlapping tree-tab switches so expansion controls recover correctly.

## Upgrade notes

- Update the client package and service together to use forest tabs and component-scoped queries. The API contract remains version 1.
- PostgreSQL deployments must run `phylo-lens-init-postgres` with the new service version before starting API replicas and workers. The schema initializer adds the required tables and indexes; it can be run again safely.
- Prepare existing datasets again to obtain component summaries, subtree indices and the revised small-component policy. The preparation pipeline identity is now `component-panels-lod-v5`.
- Automatic relaxation is now opt-in. Position retention lasts for the current dataset session; reloading the browser or loading a new dataset clears it.

Full changelog: https://github.com/phyloviz/phylo-lens/compare/v0.2.4...v0.3.0
