# Examples

Small input datasets for local development and smoke testing.

## Newick

- [small-balanced.newick](newick/small-balanced.newick): unweighted topology,
  useful for normalization tests.
- [with-branch-lengths.newick](newick/with-branch-lengths.newick): weighted
  topology, suitable for `prepare` and visible-slice LoD queries.
- [phyloviz-spneumoniae.nwk](newick/phyloviz-spneumoniae.nwk): weighted
  *Streptococcus pneumoniae* tree (~379 nodes) exported from PHYLOViZ. Small
  enough to render whole (no cluster triangles) while still exercising the
  `prepare` and region-selection paths.

## Ancillary Metadata

- [phyloviz-spneumoniae.tsv](ancillary/phyloviz-spneumoniae.tsv): **tab-separated**
  isolate metadata (country, region, year, serotype, ST, source, ...) that
  joins onto `phyloviz-spneumoniae.nwk`. Load it as the ancillary input with
  format `tsv` (or `auto`) and join column `id`. It populates the per-node and
  overview distribution wheels; leaf ids without a matching row are left blank.

## Local Demo

Start the server:

```bash
cd code/server
uvicorn phylo_lens_server.main:app --reload
```

Start the client:

```bash
cd code/client
npm run dev
```

Use a weighted Newick example when testing the active `prepare` and
`view-slice` path.
