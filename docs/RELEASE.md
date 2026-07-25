# Release and CI

PhyloLens uses a single thesis-friendly monorepo release version. A tag named
`vX.Y.Z` releases:

- npm package: `@phyloviz/phylo-lens@X.Y.Z`;
- Docker image: `ghcr.io/phyloviz/phylo-lens-service:X.Y.Z`;
- Python service package version: `X.Y.Z`.

The API contract version is independent. Compatible implementation releases keep
the same API contract version, currently `1`.

## Continuous Integration

`.github/workflows/ci.yml` runs on pull requests to `main`, pushes to `main`,
and manual dispatch. It uses path-aware jobs:

- client validation: `npm ci`, format check, lint, tests, demo build, library
  build;
- server validation: install `.[test,dev]`, `ruff check`, server tests;
- packed-package consumer: build the library, run `npm pack`, install the
  produced tarball in `examples/public-library-host`, build the fixture;
- Docker service validation: build and smoke `linux/amd64` and `linux/arm64`
  as independent single-platform images with Buildx cache. CI loads only one
  platform per matrix entry; `linux/arm64` uses QEMU on GitHub-hosted runners.

Docker validation is skipped for client-only or documentation-only changes unless
the workflow is run manually.

## Service Architectures

The published service image supports:

- `linux/amd64`;
- `linux/arm64`.

PhyloLens builds from the `phyloviz/phylolib` source image pinned in
`code/server/Dockerfile` by manifest-list digest, not by tag or architecture
child digest. The Dockerfile is the canonical source for the pinned digest. The
container smoke script is the executable source for the expected bundled JAR
checksum; it verifies the JAR, Graphviz, Java, PhyloLib CLI startup,
PostgreSQL-driver import, health, Newick prepare, and typing-data prepare for
each tested platform.

## Creating a Release

1. Update `code/client/package.json` and `code/server/pyproject.toml` to the same
   implementation version.
2. Leave `API_VERSION` in
   `code/server/src/phylo_lens_server/versions.py` unchanged unless the HTTP
   contract is intentionally incompatible.
3. Run local validation:

   ```bash
   python scripts/check-release-version.py vX.Y.Z
   cd code/server && pytest -q
   cd ../client && npm ci && npm run format:check && npm run lint && npm test
   npm run build && npm run build:lib && npm pack
   cd ../../examples/public-library-host && npm install && npm run build
   cd ../../code/server
   DOCKER_PLATFORM=linux/amd64 IMAGE_NAME=phylo-lens-service:local-amd64 \
     CONTAINER_NAME=phylo-lens-service-smoke-amd64 ./scripts/container-smoke.sh
   DOCKER_PLATFORM=linux/arm64 IMAGE_NAME=phylo-lens-service:local-arm64 \
     CONTAINER_NAME=phylo-lens-service-smoke-arm64 ./scripts/container-smoke.sh
   ```

4. Create and push the release tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The tag triggers both release workflows. Do not publish from pull requests or
ordinary `main` pushes.

## npm Trusted Publishing

The npm release workflow publishes `@phyloviz/phylo-lens` with npm Trusted
Publishing and provenance. One-time setup in npm is required:

- package: `@phyloviz/phylo-lens`;
- repository: the PhyloLens GitHub repository;
- workflow: `.github/workflows/release-npm.yml`;
- environment: `npm-production`.

No long-lived npm write token is stored in the repository.

## GHCR Publishing

The service release workflow publishes `ghcr.io/phyloviz/phylo-lens-service`
using `GITHUB_TOKEN` with `packages: write`.

Tags pushed for `vX.Y.Z`:

- `X.Y.Z`;
- `X.Y`;
- `X`;
- `latest`.

The workflow validates `linux/amd64` and `linux/arm64` as platform-specific
images first. No public image is pushed before both architecture smoke tests
pass. It then performs a separate Buildx publication with
`platforms: linux/amd64,linux/arm64` and `push: true`, so GHCR receives one
multi-platform manifest list carrying the existing version tags and OCI labels.
This avoids relying on `load: true` for a multi-platform result, which the normal
Docker image store cannot load in one operation.

Use a protected `ghcr-production` GitHub environment for publication approval if
the repository policy requires it.

## GitHub Release

Create one GitHub Release after both publication workflows succeed. Include:

- npm package/version;
- Docker image/tag;
- API contract version;
- installation examples;
- notable changes.

Avoid publishing a GitHub Release if only one artefact was published
successfully.

## Recovering From Partial Failure

- If npm publishes but the Docker image fails, fix the Docker issue and rerun
  only the service release workflow for the same tag.
- If Docker publishes but npm fails before publish, fix npm trusted-publisher or
  package validation and rerun only the npm release workflow for the same tag.
- If npm fails after publishing, do not republish the same npm version. Verify
  the package on npm, complete the service workflow if needed, then create the
  GitHub Release manually.
- If an incorrect version was published, create a new patch version and release
  a new tag rather than mutating an existing release.
