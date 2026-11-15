# PhyloLens documentation

This directory documents the implemented PhyloLens system. It separates public
contracts from implementation details and avoids repeating configuration or
release information across several files.

## Reading guide

The [HTML manual](manual/index.html), [display guide](manual/viewing.html), and
[maintenance instructions](manual/maintenance.html) provide the documentation
website. The manual is authored directly in HTML and CSS and has no build step.
The Markdown documents below retain the detailed repository references.

| Goal | Document |
| --- | --- |
| Load, interpret and split trees by distance | [User guide](USER_GUIDE.md) |
| Understand distance metrics, cutoff and additional-link decisions | [Distance operations](DISTANCE_OPERATIONS.md) |
| Find published algorithm foundations and project-specific adaptations | [Algorithm references](ALGORITHM_REFERENCES.md) |
| Understand the browser/service boundary and the major components | [Architecture](ARCHITECTURE_SPEC.md) |
| Follow one dataset from `load()` to interactive rendering | [Runtime flow](flow.md) |
| Prepare Newick, typing profiles, and ancillary metadata correctly | [Input formats](INPUT_FORMATS.md) |
| Integrate directly with the HTTP service | [API reference](API_REFERENCE.md) |
| Use either component independently or implement a custom client | [Integration choices](INTEGRATION.md) |
| Choose and restore technical roots | [Technical rooting](REROOTING.md) |
| Understand domain, prepared, wire, and persistence models | [Data model](DATA_MODEL.md) |
| Understand ingestion, clustering, layout, jobs, and publication | [Server preparation pipeline](SERVER_PIPELINE.md) |
| Understand hop-depth tiers and semantic zoom | [LoD and clustering](LOD_AND_CLUSTERING.md) |
| Understand viewport synchronization and Sigma rendering | [Client rendering](CLIENT_RENDERING.md) |
| Understand representative expansion, meta-edges, and collapse | [Cluster expand/collapse](EXPAND_COLLAPSE.md) |
| Inspect subtree indexing, fold complexity and measurements | [Indexed branch operations](TREE_INDEX.md) |
| Configure CI, npm publication, and multi-platform Docker releases | [Release and CI](RELEASE.md) |
| Track researcher feedback, acceptance criteria and delivery dependencies | [Feedback backlog](feedback/README.md) |
| Run a public-example formative evaluation of counts and navigation | [Researcher walkthrough kit](validation/researcher-walkthrough.md) |

Component-specific setup is documented in:

- [Browser library README](../code/client/README.md)
- [API service README](../code/server/README.md)
- [Examples README](../examples/README.md)

## Documentation ownership

Each detailed topic has one canonical document:

| Topic | Canonical source |
| --- | --- |
| Public browser API | `code/client/README.md` |
| Server deployment and environment variables | `code/server/README.md` |
| HTTP request and response contracts | `docs/API_REFERENCE.md` |
| Input syntax and normalization semantics | `docs/INPUT_FORMATS.md` |
| Internal architecture and dependency direction | `docs/ARCHITECTURE_SPEC.md` |
| Persistence schema and model layers | `docs/DATA_MODEL.md` |
| CI, versioning and publication | `docs/RELEASE.md` |

Other documents link to those sources instead of duplicating complete tables or
operational procedures.

## System terminology

The documentation uses the following names consistently:

- **tree** — one connected, acyclic topology; fully labelled trees and MSTs are
  the scientific focus of PhyloLens;
- **MST** — a minimum spanning tree inferred from profile distances; this term
  does not apply to every imported Newick tree;
- **forest** — a dataset containing one or more separate trees, including isolated
  nodes after bounded goeBURST or a distance cutoff;
- **distance-connection overlay** — additional displayed links within prepared
  tree components; these do not change branches, membership, or layout springs;
- **graph** — the general node/edge representation used by transport and rendering
  libraries; its use does not imply support for arbitrary phylogenetic networks;
- **PhyloLens** — the complete system;
- **browser library** — the npm package `@phyloviz/phylo-lens`;
- **API service** — the FastAPI computational service;
- **host application** — an application that embeds the browser library;
- **prepared layout** — the persisted result of normalization, clustering,
  layout, LoD construction, and metadata materialization;
- **viewport slice** — the visible subset of a prepared forest returned for a camera state;
- **level of detail (LoD)** — a rooted hop-depth cut used for semantic zoom;
- **representative** — the node displayed in place of a multi-node cluster;
- **typing data** — an MLST/cgMLST-style allelic-profile matrix;
- **ancillary data** — tabular isolate or sample observations joined to graph
  nodes.

Newick remains compatible with unnamed internal junctions. They receive generated
structural identifiers, distinct from supplied biological labels. A generated ID
does not identify an observed isolate, and a LoD representative may stand for an
entire subtree. Ordinary user-facing descriptions use tree, MST, and forest;
renderer contracts and existing `/api/graph/*` routes retain graph terminology.

## Scope and evidence

The documentation distinguishes implemented mechanisms from evaluation claims.
Statements such as “uses bounded viewport reads” describe the architecture.
Claims about scalability, latency, memory, or comparison with other tools belong
in the thesis evaluation and must be supported by measurements.

## Source references

Internal documents cite modules and functions where this helps a reader verify a
non-obvious rule. They do not attempt to list every class or mirror the source
tree. Public consumers should rely on the documented package and HTTP contracts,
not on internal module paths.
