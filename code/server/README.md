# PhyloLens Server

Python-first server for canonical phylogenetic dataset ingestion and normalization.

## Run

```bash
pip install -e .[test]
uvicorn phylo_lens_server.main:app --reload
```

## First Endpoint

- `POST /dataset/normalize`

Payload example:

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "((A,B)X,(C,D)Y)Root;"
}
```
