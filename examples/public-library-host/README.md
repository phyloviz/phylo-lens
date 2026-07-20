# Public Library Host Fixture

Minimal external host used to validate the packed PhyloLens client package.

From the repository root:

```bash
cd code/client
npm run build:lib
npm pack

cd ../../examples/public-library-host
npm install
npm run build
```

The fixture depends on the tarball produced by `npm pack`, not the client source
directory.
