# PhyloLens browser library

`@phyloviz/phylo-lens` embeds a tree viewer in your application. Supply a DOM
container and either the PhyloLens service URL or your own `GraphClient` adapter.
The package uses ES modules and includes TypeScript declarations.

## Installation

```sh
npm install @phyloviz/phylo-lens
```

## First example

```ts
import { createPhyloLensView } from '@phyloviz/phylo-lens';

const container = document.getElementById('tree');
if (!(container instanceof HTMLElement)) throw new Error('Missing tree container.');
container.style.height = '600px';

const view = createPhyloLensView({ container, apiUrl: '/phylo-lens' });
await view.load({ content: '(A:1,B:2)Root;', sourceFormat: 'newick' });

// When the host removes the viewer:
view.dispose();
```

`load()` waits for preparation and the first rendered view. A newer load
supersedes an older pending load. Dispose the view when removing it from the page.

## API documentation

The complete reference is in the **HTML manual**:

- [Browser API](../../docs/manual/browser-api.html): view options, callbacks,
  all methods, search, expansion, rooting and PNG export.
- [Browser types](../../docs/manual/api-types.html): public options, observations,
  identifiers and custom-adapter contracts.
- [HTTP API](../../docs/manual/http-api.html): direct service use and examples.
- [Integration guide](../../docs/manual/integration.html): use either component
  independently.

Open `docs/manual/index.html` from the repository, or serve the manual with search:

```sh
python -m http.server 8010 --bind 127.0.0.1 --directory docs/manual
```

The HTML reference is the main API documentation. It is maintained against
`src/index.ts`, `src/phyloLensView.ts` and their exported contract types.
HTTP wire DTOs and renderer/workbench implementations are internal.

## Examples

- [Default service integration](../../examples/public-library-host/README.md)
- [Custom client without the service](../../examples/custom-client-host/README.md)

## Development

```sh
cd code/client
npm ci
npm run dev
```

The reference application runs on `http://localhost:3000` and proxies `/health`
and `/api` to `http://localhost:8000`. Set `VITE_PHYLO_LENS_PROXY_TARGET` to change
the target. The reference application is not part of the public package API.

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run build:lib
npm pack --dry-run
```
