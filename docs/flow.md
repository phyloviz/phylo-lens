# Runtime flow

This document shows the principal request paths through PhyloLens. It complements
the [architecture](./ARCHITECTURE_SPEC.md), [server pipeline](./SERVER_PIPELINE.md),
and [client rendering](./CLIENT_RENDERING.md) documents.

## Dataset load

```mermaid
sequenceDiagram
  participant H as Host application
  participant V as PhyloLensView
  participant W as Graph workbench
  participant C as Graph client
  participant A as API service
  participant J as Job backend
  participant P as Prepare worker
  participant S as Layout store
  participant R as Renderer

  H->>V: load(options)
  V->>W: render dataset
  W->>C: prepareGraph(request)
  C->>A: GET /health
  A-->>C: status, service_version, api_version
  C->>A: POST /api/graph/prepare
  A->>J: reserve/submit job
  J->>P: prepare canonical dataset
  A-->>C: 202 job_id

  loop poll until terminal
    C->>A: GET /api/graph/prepare/{job_id}
    A->>J: read status
    J-->>A: pending | ready | failed
    A-->>C: status response
  end

  P->>S: persist refining artifacts
  P->>S: publish ready/degraded layout

  W->>C: read initial viewport
  C->>A: POST /api/graph/viewport
  A->>S: resolve published version and read LoD slice
  S-->>A: nodes, edges, metadata, bounds
  A-->>C: viewport response
  C-->>W: validated response
  W->>R: apply positioned graph
  W-->>V: initial snapshot ready
  V-->>H: load() resolves
```

## Preparation internals

```mermaid
flowchart TD
  Request[NormalizeRequest]
  Admission[Capacity admission]
  Parse[Parse Newick or run PhyloLib]
  Canonical[CanonicalDataset]
  Fingerprint[Compute layout_version]
  Cluster[Select distance thresholds and clusters]
  PersistBase[Persist refining artifacts]
  Edges[Build per-tier quotient edges]
  Layout[Graphviz sfdp global layout]
  Fallback[Circular degraded fallback]
  PersistLayout[Persist node and cluster layouts]
  Publish[Publish ready or degraded]

  Request --> Admission --> Parse --> Canonical --> Fingerprint --> Cluster
  Cluster --> PersistBase
  Cluster --> Edges
  Cluster --> Layout
  Layout -->|missing, failed, incomplete| Fallback
  Layout --> PersistLayout
  Fallback --> PersistLayout
  Edges --> PersistLayout --> Publish
```

A Graphviz timeout fails preparation. Missing, failed, or incomplete Graphviz
output uses the documented degraded fallback.

## Camera-driven viewport refresh

```mermaid
sequenceDiagram
  participant U as User
  participant R as Sigma renderer
  participant C as Viewport controller
  participant A as API service
  participant S as Layout store

  U->>R: pan or zoom
  R->>C: camera ratio and world bounds
  C->>C: select LoD with hysteresis
  C->>C: pad bounds and debounce
  C->>A: POST /api/graph/viewport
  A->>S: bounded representative/node read
  S-->>A: slice and required edge neighbours
  A-->>C: GraphViewportResponse
  C->>R: apply latest snapshot
```

Stale responses are discarded through a request sequence. Small graphs loaded at
finest detail do not continuously query the service on camera movement.

## Search and focus

```mermaid
sequenceDiagram
  participant H as Host/workbench
  participant A as API service
  participant S as Layout store
  participant R as Renderer

  H->>A: POST /api/graph/search
  A->>S: rank identifier and metadata matches
  S-->>A: matches with global coordinates
  A-->>H: search response
  H->>A: viewport/region request around selected match
  A-->>H: graph patch
  H->>R: merge patch, centre and highlight
```

Search is server-side because a matching node may not exist in the current
viewport slice.

## Cluster expansion

```mermaid
sequenceDiagram
  participant U as User
  participant C as Viewport controller
  participant A as API service
  participant S as Layout store
  participant R as Renderer

  U->>C: click representative
  C->>C: capture representative and incident edges
  C->>A: viewport request with cluster_id
  A->>S: read members, internal edges and neighbours
  S-->>A: expansion nodes and meta-edges
  A-->>C: expansion response
  C->>R: merge expansion patch

  U->>C: collapse
  C->>C: restore cached representative snapshot
  C->>R: apply collapsed graph
```

Expansion is stateless on the server. Collapse is local and does not issue a
second request.

## Deployment flow

```text
browser
  → same-origin reverse proxy (recommended)
  → PhyloLens API service
  → local registry + SQLite

or

browser
  → API replicas
  → PostgreSQL durable jobs and artifacts
  ← external preparation workers
```

Docker-internal service names are not browser URLs. A host application must use
an externally reachable URL or a reverse-proxy path.
