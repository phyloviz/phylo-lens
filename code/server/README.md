# PhyloLens Server

FastAPI service for deterministic phylogenetic normalization, weighted LoD
precomputation, spatial indexing, and visible-slice queries.

## Setup

```bash
cd code/server
pip install -e '.[test]'
```

## Run

```bash
uvicorn phylo_lens_server.main:app --reload
```

Or, after installation:

```bash
phylo-lens-server
```

## API

### `GET /health`

Returns service health.

### `POST /dataset/normalize`

Parses and normalizes a dataset into `CanonicalDataset`.

Example:

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "(A:1,(B:2,C:4)N:3)R;"
}
```

### `POST /dataset/prepare`

Normalizes input and builds the active LoD runtime artifacts:

- `ThresholdHierarchyIndex`;
- global cluster bounds;
- representative coordinates;
- STR spatial indexes per LoD level.

The active prepare path requires weighted edges. Newick branch lengths or
edge-list `distance` values are used as threshold distances.

### `POST /dataset/view-slice`

Returns a bounded visible graph slice for a prepared dataset.

Example:

```json
{
  "dataset_id": "example-tree",
  "viewport": { "x": 0, "y": 0, "width": 1000, "height": 600 },
  "zoom": 2.0,
  "max_nodes": 3000
}
```

The response includes visible nodes, visible edges, collapsed cluster metadata,
returned counts, and `global_bounds` for stable client camera mapping.

## Storage

Prepared datasets are stored through `DatasetStore`.

Environment variables:

- `PHYLO_LENS_STORE_DIR`: store directory. Defaults to `.phylo_lens_store`.
- `PHYLO_LENS_STORE_PERSIST`: `true` or `false`. Defaults to `true`.

## Benchmarking

```bash
phylo-lens-benchmark-lod --sizes 1000 10000 100000 --repeats 7
```

The benchmark reports median values for:

- hierarchy build time;
- hierarchy build peak memory;
- visible-slice selection time;
- returned node, edge, and collapsed-cluster counts.

JSON output:

```bash
phylo-lens-benchmark-lod --sizes 1000 --repeats 3 --format json
```

## Tests

```bash
pytest -q
```
