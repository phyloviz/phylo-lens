# PhyloLens browser library

`@phyloviz/phylo-lens` is the public browser package for embedding a PhyloLens
visualization in a host application.

The package owns the complete client lifecycle:

- service compatibility validation;
- graph preparation and status polling;
- viewport synchronization;
- semantic-zoom tier selection;
- Sigma/Graphology renderer lifecycle;
- metadata-driven visual mappings;
- cluster expansion and collapse.

The host application supplies a DOM container, a PhyloLens API service base URL,
and input content. HTTP DTOs, job identifiers, layout versions, renderer
factories, and viewport controllers are internal implementation details.

## Installation

```bash
npm install @phyloviz/phylo-lens
```

The package is ESM-only and includes TypeScript declarations. Sigma, Graphology,
and the renderer plug-ins used by the default implementation are installed as
package dependencies.

## Basic integration

```ts
import { createPhyloLensView } from "@phyloviz/phylo-lens";

const container = document.getElementById("graph-root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Missing graph container.");
}

const view = createPhyloLensView({
  container,
  apiUrl: "/phylo-lens",
});

await view.load({
  content: "(A:1,(B:2,C:4)N:3)R;",
  name: "example-tree",
  sourceFormat: "newick",
});

view.dispose();
```

`load()` resolves only after:

1. the service reports a compatible API contract;
2. preparation completes successfully (including any expensive global `sfdp`
   layout; the default wait is unlimited);
3. the first viewport response is received;
4. the first graph snapshot is applied to the renderer.

A newer `load()` supersedes an older in-flight load. `dispose()` invalidates
pending loads and releases renderer event handlers and resources.

`exportPng()` returns a reusable `Blob` for the current visible view. It keeps
the current camera, semantic-zoom materialization, and visible Sigma canvas
layers; it does not trigger a browser download or change the view state. SVG is
not currently exposed because faithfully reproducing Sigma's WebGL/custom-program
rendering as vector geometry requires a separate vector renderer.

## Public package surface

The package root exports:

```ts
createPhyloLensView
PhyloLensView
PhyloLensViewOptions
PhyloLensLoadOptions
AncillaryField
SourceFormat
Viewport
VisualMappingOptions
PhyloLensServiceUnavailableError
PhyloLensServiceProtocolError
IncompatiblePhyloLensServiceError
SUPPORTED_PHYLO_LENS_API_VERSION
```

Transport clients, workbench classes, renderer adapters, Graphology types, and
HTTP response DTOs are intentionally not exported.

## `createPhyloLensView`

```ts
function createPhyloLensView(options: PhyloLensViewOptions): PhyloLensView;
```

### `PhyloLensViewOptions`

| Field | Type | Description |
| --- | --- | --- |
| `container` | `HTMLElement` | Element owned by the host application. PhyloLens mounts the Sigma renderer inside it. |
| `apiUrl` | `string` | Base URL or path prefix used for `/health` and `/api/graph/*` requests. |

Supported `apiUrl` forms:

| Value | Result |
| --- | --- |
| `"http://localhost:8000"` | Direct access to a local service |
| `"https://api.example.org"` | Direct cross-origin service access; the service must allow the host origin through CORS |
| `""` | Same-origin `/health` and `/api/graph/*` routes |
| `"/phylo-lens"` | Same-origin reverse-proxy prefix |

Trailing slashes are normalized. PhyloLens does not add authentication headers
or browser credentials.

## `PhyloLensView`

```ts
interface PhyloLensView {
  load(options: PhyloLensLoadOptions): Promise<void>;
  expandCluster(clusterId: string): Promise<ExpansionResult>;
  collapseCluster(clusterId: string): ExpansionState;
  expandAll(): Promise<ExpansionResult>;
  collapseAll(): Promise<ExpansionResult>;
  setKeepExpanded(keep: boolean): ExpansionState;
  getExpansionState(): ExpansionState;
  exportPng(): Promise<Blob>;
  dispose(): void;
}
```

### Explicit expansion

Click selects; double-click and the wheel zoom. Host applications can use
`onNodeSelected` in `createPhyloLensView` options to receive
`{ nodeId, clusterId, expandable }`, then invoke the expansion methods from their
own controls. `onExpansionChanged` receives the resulting `ExpansionState` after
graph updates.

After loading, `view.setKeepExpanded(true)` pins the current detail tier while
retaining expanded groups across viewport changes. `await view.expandAll()` requests
all finest-detail nodes within the configured `lod.maxNodes` budget. Inspect the
returned `status` (`complete`, `partial`, or `superseded`): a partial result must not
be presented as a fully expanded tree. `await view.collapseAll()` returns to the
coarsest tier. Disabling persistence resumes automatic detail selection.

See [expansion commands and limits](../../docs/EXPAND_COLLAPSE.md) for state,
concurrency and ancillary-update semantics.

### `load`

Prepares and renders a dataset. A call replaces the previously loaded dataset.
The returned promise rejects on service, protocol, preparation, or initial
viewport failures.

### `dispose`

Unmounts the renderer and invalidates pending work. Repeated calls are safe.
Calling `load()` after disposal rejects.

## `PhyloLensLoadOptions`

```ts
interface PhyloLensLoadOptions {
  content: string;
  name?: string;
  sourceFormat?: "newick" | "typing_data";
  ancillarySchema?: AncillaryField[];
  ancillaryByNodeId?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  ancillaryData?: {
    format: "auto" | "csv" | "tsv";
    content: string;
    join_column: string;
  };
  visualMapping?: VisualMappingOptions;
  layout?: {
    forceIterations?: number;
  };
  lod?: {
    maxNodes?: number;
    lodHint?: number;
    viewport?: Viewport;
  };
}
```

| Field | Required | Default | Behavior |
| --- | --- | --- | --- |
| `content` | yes | — | Raw Newick text or an allelic-profile matrix, according to `sourceFormat` |
| `name` | no | `"uploaded-dataset"` | Dataset identifier submitted to the service |
| `sourceFormat` | no | `"newick"` | Selects direct Newick parsing or PhyloLib typing-data processing |
| `ancillarySchema` | no | `[]` | Declares ancillary fields and scalar types |
| `ancillaryByNodeId` | no | `{}` | Direct ancillary data keyed by node ID |
| `ancillaryData` | no | — | CSV/TSV metadata joined by an explicit column |
| `visualMapping` | no | library defaults | Controls node color, size and pie attributes |
| `lod.maxNodes` | no | `6000` | Primary node budget used for viewport requests |
| `layout.forceIterations` | no | — | Reserved by the current public type; not applied by the server pipeline |
| `lod.lodHint` | no | — | Reserved by the current public type; semantic zoom is currently derived from camera ratio |
| `lod.viewport` | no | — | Reserved by the current public type; the initial query is derived from renderer state |

The reserved fields are documented explicitly because they are present in the
published TypeScript contract. Applications should not depend on them until
runtime behavior is implemented and documented.

## Source formats

### Newick

```ts
await view.load({
  name: "weighted-tree",
  sourceFormat: "newick",
  content: "(A:0.1,(B:0.2,C:0.3)N:0.4)R;",
});
```

The service accepts one tree or a `;`-separated forest. Labels are normalized to
stable canonical identifiers. See [Input formats](../../docs/INPUT_FORMATS.md)
for parser behavior and branch-length rules.

### Typing data

```ts
await view.load({
  name: "mlst-profiles",
  sourceFormat: "typing_data",
  content: [
    "ST\tadk\tfumC",
    "A\t1\t2",
    "B\t1\t3",
    "C\t4\t5",
  ].join("\n"),
});
```

The service sends the profile matrix through the bundled PhyloLib JAR:
Hamming distance is computed first, followed by goeBURST Full MST. The resulting
Newick tree enters the normal preparation pipeline.

## Metadata

### Direct metadata

```ts
await view.load({
  content: "(P09:1,P12:2)R;",
  ancillarySchema: [
    { key: "country", type: "string" },
    { key: "year", type: "number" },
  ],
  ancillaryByNodeId: {
    p09: { country: "Portugal", year: 2024 },
    p12: { country: "Canada", year: 2023 },
  },
});
```

Canonical IDs are lowercase slugs of explicit Newick labels. Duplicate labels
receive deterministic suffixes.

### Ancillary CSV/TSV metadata

```ts
await view.load({
  content: "(P09:1,P12:2)R;",
  ancillaryData: {
    format: "tsv",
    join_column: "isolate",
    content: [
      "isolate\tcountry\tsource",
      "P09\tPortugal\thuman",
      "P12\tCanada\tanimal",
    ].join("\n"),
  },
});
```

`join_column` is required. The service tries an exact identifier match and then
a canonical slug match. When direct metadata and ancillary metadata define the
same node field, the direct value takes precedence.

## Supporting public types

```ts
type SourceFormat = "newick" | "typing_data";

type MetadataType = "string" | "number" | "boolean" | "null";

interface AncillaryField {
  key: string;
  type: MetadataType;
}

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

`Viewport` remains exported because it is referenced by the reserved
`lod.viewport` option. The current load path does not use that option to construct
the initial API request.

## Ancillary data and domain terminology

`AncillaryData` is a record of user observations (country, year, etc.). An
`Isolate` keeps its original `id` and `ancillaryData`. The internal node model
separates `ancillaryData`, `ancillarySummary.categoryCounts`, and
`profileSummary.isolateCount`; a missing count means unknown, not zero.
A graph node may represent one profile shared by multiple isolates, or a LoD
cluster containing multiple profiles. Neither a graph node nor a metadata row
is automatically a distinct isolate.

Prefer `ancillarySchema` and `ancillaryByNodeId` in `view.load`. Existing
`metadataSchema`, `metadataByNodeId` and the exported `MetadataField` type remain
supported as deprecated aliases. Supplying both names for the same option is an
error. `ancillaryData` continues to accept a CSV/TSV table input; its shape is
exported as `AncillaryTableInput`, distinct from an individual `AncillaryData`
record.

The API v1 wire format and SQL storage retain their `metadata_*` names. The
client translates these at the boundary, so existing services/layouts remain
readable. Advanced Ancillary JSON accepts `ancillary_schema` and
`ancillary_by_node_id`, as well as the deprecated `metadata_*` names.
Technical layout information and provenance are not ancillary data.

Scalar values produced by grouping (for example, a concatenated set of countries)
are stored in `AncillarySummary.values`, alongside category frequencies. Original
per-isolate values remain in `Isolate` ancillary data. Flat legacy records with
computed counts are decoded as node summaries; legacy records without counts
remain direct ancillary values.

## Visual mapping

```ts
interface VisualMappingOptions {
  colorField?: string;
  sizeField?: string;
  size?: {
    field?: string;
    scale?: "linear" | "log";
  };
  palette?: string[];
  pie?: {
    enabled?: boolean;
    fields?: string[];
    palette?: string[];
    categoryColors?: Record<string, string>;
  };
}
```

Behavior:

- `colorField` selects a metadata field for frequency-ranked categorical
  coloring;
- `size.field` or the legacy `sizeField` selects a numeric metadata field;
- `size.scale` selects linear or logarithmic scaling;
- `palette` overrides the node-color palette;
- `pie` controls pie attributes for aggregate nodes.

Without an explicit `colorField` or pie mapping, profile nodes use a neutral
slate color. Metadata names such as `region`, `selected` or `founder` do not
implicitly enable coloring in server viewport snapshots. LoD clusters retain
their structural triangle styling. When no size field is requested, the client
prefers `profile_count` when available and otherwise uses `distance`.

In the demo, selecting a Pie Field enables metadata coloring and shows the
active field above each distribution. Selecting `None — neutral nodes` clears
both the color field and pies. Loading another dataset resets the selection and
palette overrides; an explicit mapping in Advanced Ancillary JSON initializes
the new selection.

The selected-node panel shows the profile ID, represented isolate count and
original isolate IDs independently of color selection. LoD clusters are labeled
as clusters, with separate profile and isolate counts. Selection and the open
ID list survive viewport refreshes; a selected node outside the current view
shows an explicit message instead of stale details.

## Service compatibility errors

The first preparation checks `${apiUrl}/health`. Applications may catch the
exported errors:

```ts
import {
  IncompatiblePhyloLensServiceError,
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
} from "@phyloviz/phylo-lens";

try {
  await view.load({ content: newick });
} catch (error) {
  if (error instanceof IncompatiblePhyloLensServiceError) {
    console.error(error.expectedApiVersion, error.receivedApiVersion);
  } else if (error instanceof PhyloLensServiceUnavailableError) {
    console.error("Service unavailable", error.cause);
  } else if (error instanceof PhyloLensServiceProtocolError) {
    console.error("Invalid /health response", error.cause);
  }
}
```

Successful compatibility checks are cached per view. Failed checks are not
cached, so a later `load()` can recover after the service is restarted or fixed.

## Development

```bash
cd code/client
npm ci
npm run dev
```

The Vite demo runs on `http://localhost:3000` and proxies `/health` and `/api`
to `http://localhost:8000`. Override the target with:

```bash
VITE_PHYLO_LENS_PROXY_TARGET=http://127.0.0.1:8001 npm run dev
```

Validation commands:

```bash
npm run format:check
npm run lint
npm test
npm run build       # reference demo
npm run build:lib   # npm package
npm pack --dry-run
```

The demo shell is a reference integration and test surface. It is not part of
the public package API.

## Hide or restore node pie charts

In the reference demo, uncheck **Show node pie charts** to display solid nodes.
Check it again to restore pies with the selected fields and palette. Metadata,
filters, and ancillary summary wheels remain available.

Host applications can change the mapping after `load()` completes:

```ts
view.updateVisualMapping({ pie: { enabled: false } });
view.updateVisualMapping({ pie: { enabled: true, fields: ["country"] } });
```

`updateVisualMapping()` replaces the visual mapping; include any color, size,
or palette settings you want to retain. It schedules a viewport refresh and
returns immediately. It requires a loaded tree and throws after disposal.
This changes presentation without deleting stored ancillary data or preparing
the tree again.

## Apply ancillary data after loading

Upload a CSV/TSV table to an already loaded tree without preparing it again:

```ts
const result = await view.applyAncillaryData({
  content: "id,country\nA,Portugal\nB,Canada\n",
  format: "csv",
  join_column: "id",
});
console.log(result.matchedNodeCount, result.warnings);
view.updateVisualMapping({ pie: { enabled: true, fields: ["country"] } });
```

In the reference demo, choose an **Ancillary Table**, set its join column, then
click **Apply table to current tree**. The action becomes available after loading.

Applying a table replaces the node metadata and schema, including metadata
supplied with the original load; omitted fields and unmatched nodes do not retain
old values. The server keeps the previous version intact. Unknown identifiers
produce warnings; a table with no matching nodes fails without changing the view.
For typing datasets, identifiers match original isolate IDs; each isolate accepts
at most one row. All isolate identities and profile counts survive replacement,
including isolates without a matching row. Newick tables match canonical node IDs
with the label slug fallback and may contain multiple rows per node.

The promise resolves after the updated viewport is applied. Camera position,
geometry (including dragged positions), display settings, and filters are retained.
Expanded clusters and their collapse summaries are refreshed to the new revision. Select fields from the new table if the previous pie fields no longer
exist. A failed upload or viewport fetch keeps the previous view usable.

A second simultaneous upload is rejected. Loading another tree or disposing the
view prevents a pending upload from being applied to that view; an already
published server version may remain available. Uploads require the companion
service to support `PUT /api/graph/ancillary`.
