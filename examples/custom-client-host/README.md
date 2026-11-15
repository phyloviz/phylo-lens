# Custom client host

This external application uses only exports from `@phyloviz/phylo-lens`.
Its `GraphClient` serves one precomputed example tree directly from memory.
No Python service, `/health`, HTTP DTOs, or repository source imports are used.
Search, focus, pan, zoom, and PNG export work with the same public viewer.

The adapter requires the release that introduces public `GraphClient` support.
For an unpublished checkout, first build and pack `code/client`, then install the
resulting tarball here:

```sh
cd code/client
npm run build:lib
npm pack --ignore-scripts --pack-destination /tmp
cd ../../examples/custom-client-host
npm install /tmp/phyloviz-phylo-lens-0.3.0.tgz
npm run dev
```

The repository's packed-package consumer smoke test builds this example against
the actual tarball automatically. The fixture adapter validates its supported
input explicitly. It is a small integration example, not a general Newick parser
or a backend supporting large datasets. Larger adapters must implement bounded
viewport reads, coherent LoD groups and the optional operations they expose.
