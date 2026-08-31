# PhyloLens documentation

This directory documents the implemented PhyloLens system. It separates public
contracts from implementation details and avoids repeating configuration or
release information across several files.

## Reading guide

| Goal | Document |
| --- | --- |
| Understand the browser/service boundary and the major components | [Architecture](ARCHITECTURE_SPEC.md) |
| Follow one dataset from `load()` to interactive rendering | [Runtime flow](flow.md) |
| Prepare Newick, typing profiles, and ancillary metadata correctly | [Input formats](INPUT_FORMATS.md) |
| Integrate directly with the HTTP service | [API reference](API_REFERENCE.md) |
| Understand canonical, prepared, wire, and persistence models | [Data model](DATA_MODEL.md) |
| Understand normalization, clustering, layout, jobs, and publication | [Server preparation pipeline](SERVER_PIPELINE.md) |
| Understand distance-threshold tiers and semantic zoom | [LoD and clustering](LOD_AND_CLUSTERING.md) |
| Understand viewport synchronization and Sigma rendering | [Client rendering](CLIENT_RENDERING.md) |
| Understand representative expansion, meta-edges, and collapse | [Cluster expand/collapse](EXPAND_COLLAPSE.md) |
| Configure CI, npm publication, and multi-platform Docker releases | [Release and CI](RELEASE.md) |

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

- **PhyloLens** — the complete system;
- **browser library** — the npm package `@phyloviz/phylo-lens`;
- **API service** — the FastAPI computational service;
- **host application** — an application that embeds the browser library;
- **prepared layout** — the persisted result of normalization, clustering,
  layout, LoD construction, and metadata materialization;
- **viewport slice** — the bounded graph subset returned for a camera state;
- **level of detail (LoD)** — a distance-threshold tier used for semantic zoom;
- **representative** — the node displayed in place of a multi-node cluster;
- **typing data** — an MLST/cgMLST-style allelic-profile matrix;
- **ancillary metadata** — tabular isolate or sample metadata joined to graph
  nodes.

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
