# Examples

Small input datasets for local development and smoke testing.

## Newick

- [small-balanced.newick](newick/small-balanced.newick): unweighted topology,
  useful for normalization tests.
- [with-branch-lengths.newick](newick/with-branch-lengths.newick): weighted
  topology, suitable for `prepare` and visible-slice LoD queries.

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
