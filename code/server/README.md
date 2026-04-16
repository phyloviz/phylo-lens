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
