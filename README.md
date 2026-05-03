# PhyloLens

PhyloLens is a prototype data engine and client for scalable phylogenetic
visualization. It is designed around map-like semantic zoom: the server
precomputes level-of-detail data structures and the client renders only the
visible slice for the current camera viewport.

The project is thesis-oriented, but the implementation follows production-style
boundaries:

- `code/server`: FastAPI service for parsing, normalization, LoD precompute,
  spatial indexing, and visible-slice queries.
- `code/client`: TypeScript/Sigma client for camera interaction, proxy-aware
  rendering, and metadata-driven visual mappings.
- `docs`: maintained technical documentation only.
- `examples`: small input datasets for local runs and tests.

## Current Runtime

The active path is weighted threshold LoD:

1. `POST /dataset/prepare` parses and normalizes Newick or edge-list input.
2. The server builds a deterministic distance-threshold hierarchy using
   Union-Find over weighted edges.
3. The server computes stable representative coordinates and cluster bounds.
4. The server builds static STR-packed spatial indexes per LoD level.
5. `POST /dataset/view-slice` translates camera viewport + zoom into a bounded
   graph slice.
6. The client renders backend-positioned real nodes and proxy nodes in Sigma.

PhyloLens deliberately avoids full-graph rendering for large datasets. The
runtime contract is `O(visible slice)` transfer and rendering, with server-side
precomputation absorbing the expensive global work.

## Algorithms And Data Structures

- **Canonical normalization**: deterministic node/edge contracts for Newick and
  edge-list inputs.
- **Union-Find threshold hierarchy**: clusters are generated from weighted edge
  thresholds, ordered from coarse to fine LoD.
- **Representative proxy nodes**: collapsed clusters are represented by stable
  real node ids with explicit `cluster_id`, `subtree_size`, and `leaf_count`.
- **Global coordinate space**: server-provided `global_bounds` keeps camera
  queries stable across slice refreshes.
- **STR-packed R-tree**: each LoD level has a static spatial index over cluster
  bounding boxes for efficient viewport/window queries.

The design is inspired by large-graph map exploration systems such as
graphVizdb: offline layout/index construction, followed by low-latency spatial
queries during interaction.

## Development

Server:

```bash
cd code/server
pip install -e '.[test]'
uvicorn phylo_lens_server.main:app --reload
```

Client:

```bash
cd code/client
npm ci
npm run dev
```

Validation:

```bash
cd code/server
pytest -q

cd ../client
npm run build
npm test
```

Benchmarking:

```bash
cd code/server
phylo-lens-benchmark-lod --sizes 1000 10000 100000 --repeats 7
```

## Documentation

- [Architecture](docs/ARCHITECTURE_SPEC.md)
- [LoD and Spatial Indexing](docs/LOD_SPATIAL_INDEX.md)
- [Server API](code/server/README.md)
- [Examples](examples/README.md)
