# Getting started

## Run the application

Start the [API service](../code/server/README.md) and browser application from
the repository:

```sh
# Terminal 1, from the repository root
python -m pip install -e 'code/server[test,dev]'
python -m uvicorn phylo_lens_server.main:app --host 127.0.0.1 --port 8000

# Terminal 2
cd code/client
npm ci
npm run dev
```

The development page proxies service requests to port 8000. Newick preparation
requires Graphviz `sfdp`. Typing inference additionally requires Java and the
configured PhyloLib JAR. The service Docker image includes those dependencies;
see [server installation](../code/server/README.md) for deployment and configuration.

## Load your first tree

Open the **Data** panel and choose **Newick**. Save this fully labelled example
as `example.nwk`, then choose that file:

```text
((PT-01:1,PT-02:1)Lineage:1,ES-01:2)Root;
```

Apply the input. Pan by dragging the background and zoom with the wheel.
Select a node to inspect it in the right-hand panel. Search locates original
identifiers and ancillary values across the prepared dataset.

For typing data, choose **Typing data**, supply a tab-separated allelic matrix,
and select either Full MST or standard goeBURST. Standard goeBURST defaults to
maximum nLV 3 and may produce separate components. The
[input guide](INPUT_FORMATS.md) explains missing loci and equivalent profiles.

## Attach observations

Provide a CSV/TSV ancillary table and select its identifier column. For example:

```csv
ID,country
PT-01,Portugal
PT-02,Portugal
ES-01,Spain
```

Choose an ancillary field to color the view. Pie distributions and original
isolate records remain available when several isolates share a typing profile.

## Explore and export

Use **Expand** and **Collapse** controls to inspect groups. A technical root can
change the orientation of rooted branches and detail groups. The
[visual walkthrough](walkthrough.md) shows these operations with screenshots.

Export the current view as a PNG with its legend. Keep the image's scope in mind:
it shows the current camera and visible detail, including any folded branches.

## Embed the viewer

```ts
import { createPhyloLensView } from '@phyloviz/phylo-lens';

const view = createPhyloLensView({ container, apiUrl: 'https://your-service.example' });
await view.load({ content: '(A:1,B:2)Root;', sourceFormat: 'newick' });
```

The container must have a visible width and height. Continue with the
[integration guide](INTEGRATION.md) for custom adapters and standalone server use.
