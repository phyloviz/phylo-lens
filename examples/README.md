# Examples

This folder contains small sample datasets and demo inputs for PhyloLens.

## Newick Samples

- [small-balanced.newick](newick/small-balanced.newick)
- [with-branch-lengths.newick](newick/with-branch-lengths.newick)

## Running Client Demo

From [code/client](../code/client):

```bash
npm install
npm run demo
```

Then open the local URL shown by Vite and test with one of the sample Newick files.

## Full Demo (Server + Client + Ancillary)

1. Start the server from code/server:

```bash
source .venv/bin/activate
phylo-lens-server
```

2. Start the client from code/client:

```bash
npm run demo
```

3. In the demo UI:

- paste a Newick tree,
- optionally edit the Ancillary JSON block,
- submit and inspect node color, size, and pie-chart slices.

The Sigma renderer now uses the official pie-chart node program and consumes ancillary-derived slice attributes.
