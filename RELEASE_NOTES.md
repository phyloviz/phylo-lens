## Changes

- Choose goeBURST Full MST or standard goeBURST with a maximum nLV level, defaulting to 3. Equivalent profiles keep their original isolate identities and observations.
- Change a component's technical root and rebuild its levels of detail while preserving tree edges, distances, coordinates and sample information. Restore the original roots when needed.
- Connect the browser viewer to a custom `GraphClient`. Public adapter contracts and a standalone example support using the viewer without the companion service.
- Explore the complete [HTML documentation](https://phyloviz.github.io/phylo-lens/), with screenshots, user instructions, browser and HTTP API references, search and an OpenAPI download.
- Split trees with a distance cutoff and add separate distance-connection overlays without changing the prepared branches.
- Improve viewport responsiveness and group clarity, and strengthen client, server, browser and package-consumer verification.

## Upgrade notes

- Update the browser package and service together for the new operations. The HTTP API contract remains version 1.
- PostgreSQL deployments must run `phylo-lens-init-postgres` using the new service image before starting updated API replicas and preparation workers. Schema v5 adds preparation snapshots needed for technical-root revisions.
- Load older inputs again to create snapshots and the revised LoD artifacts. Existing prepared versions remain readable; versions without snapshots cannot be rerooted. The preparation pipeline identity is `technical-root-revisions-lod-v6`.
- A changed technical root clears manual folds, explicit expansions and additional connections, while preserving the active component and camera. Technical rooting does not perform PHYLOViZ founder-prioritised edge selection.
- Explicit typing options and distance cutoffs require confirmation in the preparation response. Update older services that ignore those settings.

Full changelog: https://github.com/phyloviz/phylo-lens/compare/v0.3.0...v0.4.0
