# PhyloLens Server

Python-first server for canonical phylogenetic dataset ingestion and normalization.

## Run

```bash
pip install -e .[test]
uvicorn phylo_lens_server.main:app --reload
```

## Endpoints

- `POST /dataset/normalize`
- `POST /dataset/prepare`
- `POST /dataset/view-slice`

Payload example:

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "((A,B)X,(C,D)Y)Root;"
}
```

Prepare + visible-slice example:

```json
{
  "dataset_id": "example-tree",
  "viewport": { "x": 0, "y": 0, "width": 1000, "height": 600 },
  "zoom": 0.4
}
```

## Benchmark

Run the server-side LoD benchmark harness on synthetic trees:

```bash
pip install -e .[test]
phylo-lens-benchmark-lod --sizes 1000 10000 100000 --repeats 7
```

What it measures:

- hierarchy build median time
- hierarchy build median peak memory via `tracemalloc`
- visible-slice selection median time
- returned node, edge, and collapsed-cluster counts for overview, mid, and focused-detail queries

Example JSON output:

```bash
phylo-lens-benchmark-lod --sizes 1000 --repeats 3 --format json
```
