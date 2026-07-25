# CI and release process

PhyloLens uses one implementation version for the monorepo. A tag named
`vX.Y.Z` releases:

- `@phyloviz/phylo-lens@X.Y.Z`;
- `ghcr.io/phyloviz/phylo-lens-service:X.Y.Z`;
- Python service version `X.Y.Z`.

The HTTP API contract has an independent version, currently `1`. Compatible
implementation releases do not increment the API version.

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests to `main`, pushes to `main`,
and manual dispatch. A path-filter job selects the required validation jobs.

### Client validation

Runs from `code/client`:

```text
npm ci
npm run format:check
npm run lint
npm test
npm run build
npm run build:lib
```

### Server validation

Runs from `code/server` with Python 3.12:

```text
python -m pip install -e '.[test,dev]'
ruff check src tests
ruff format --check src tests
pytest -q
```

The Ruff version is pinned in `code/server/pyproject.toml`. The pre-commit Ruff
hooks use the same version. CI should print the installed version when debugging
a toolchain mismatch.

### Packed-package consumer

The package-consumer job validates the artifact that would be published, not a
source-directory import:

1. build the library;
2. run `npm pack`;
3. install the generated tarball in `examples/public-library-host`;
4. build the external host.

### Docker service validation

Docker validation is a two-entry matrix:

- `linux/amd64`;
- `linux/arm64`.

Each platform is built as a separate single-platform image with `load: true` and
then passed to the complete container smoke test. ARM64 uses QEMU on the
GitHub-hosted AMD64 runner.

The smoke test verifies:

- container health;
- Newick prepare and viewport flow;
- typing-data/PhyloLib prepare and viewport flow;
- Graphviz `sfdp`;
- Java runtime;
- bundled JAR checksum;
- PhyloLib CLI startup;
- PostgreSQL driver import.

Path filtering avoids Docker builds for unrelated changes. Manual dispatch runs
all checks.

## Supported container platforms

The published service image supports:

```text
linux/amd64
linux/arm64
```

`code/server/Dockerfile` is the canonical source for the pinned multi-platform
PhyloLib manifest digest. `code/server/phylolib.jar.sha256` is the canonical
expected checksum of the bundled JAR. The container smoke script reads and
verifies that checksum.

Do not copy the digest or checksum into additional documents. Mutable values
should have one executable source of truth.

## Version preparation

Before releasing `X.Y.Z`:

1. set `code/client/package.json` to `X.Y.Z`;
2. set `code/server/pyproject.toml` to `X.Y.Z`;
3. leave API version `1` unchanged unless the wire contract becomes
   incompatible;
4. update user-facing release notes;
5. run the full validation commands below.

Validate version coordination:

```bash
python scripts/check-release-version.py vX.Y.Z
```

The script verifies the tag form and the client/server implementation versions.
It reports the independent API contract version but does not require it to equal
`X.Y.Z`.

## Local release validation

### Server

```bash
cd code/server
python -m pip install -e '.[test,dev]'
ruff check src tests
ruff format --check src tests
pytest -q
```

### Client and package artifact

```bash
cd code/client
npm ci
npm run format:check
npm run lint
npm test
npm run build
npm run build:lib
npm pack --dry-run

cd ../../
./scripts/packed-package-consumer-smoke.sh
```

### Service image

```bash
cd code/server

DOCKER_PLATFORM=linux/amd64 \
IMAGE_NAME=phylo-lens-service:local-amd64 \
CONTAINER_NAME=phylo-lens-service-smoke-amd64 \
./scripts/container-smoke.sh

DOCKER_PLATFORM=linux/arm64 \
IMAGE_NAME=phylo-lens-service:local-arm64 \
CONTAINER_NAME=phylo-lens-service-smoke-arm64 \
./scripts/container-smoke.sh
```

On an AMD64 host, ARM64 execution requires QEMU/binfmt support.

## Creating the release

Create an annotated or lightweight tag only after `main` is green:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag triggers the npm and service workflows independently. Release workflows
use non-cancelling concurrency groups so a later run cannot cancel publication in
progress.

## npm publication

`.github/workflows/release-npm.yml` publishes the public package through npm
Trusted Publishing and OIDC.

Required one-time npm configuration:

| Setting | Value |
| --- | --- |
| Package | `@phyloviz/phylo-lens` |
| GitHub repository | `phyloviz/phylo-lens` |
| Workflow | `.github/workflows/release-npm.yml` |
| GitHub environment | `npm-production` |

The workflow:

1. validates the tag and monorepo versions;
2. installs dependencies reproducibly;
3. rejects a version already present on npm;
4. runs client validation;
5. builds and inspects the tarball;
6. publishes with public access and provenance.

No long-lived npm write token is required.

## GHCR publication

`.github/workflows/release-service.yml` publishes:

```text
ghcr.io/phyloviz/phylo-lens-service
```

It authenticates with `GITHUB_TOKEN` and `packages: write`.

For `vX.Y.Z`, the workflow produces:

- `X.Y.Z`;
- `X.Y`;
- `X`;
- `latest`.

Publication order:

1. build and smoke-test `linux/amd64`;
2. build and smoke-test `linux/arm64`;
3. log in to GHCR;
4. build and push one multi-platform manifest for both architectures.

No public image is pushed before both validation builds pass. The final
multi-platform build uses `push: true`; it is not loaded into the runner's local
Docker image store.

OCI labels record the repository source and commit revision. Use the
`ghcr-production` environment for repository-level approval or policy controls.

## GitHub Release

Create one GitHub Release after both publication workflows succeed. Include:

- release version;
- npm package identifier;
- Docker image identifier;
- API contract version;
- notable changes and compatibility notes;
- minimal installation examples.

Do not announce both artifacts as available until both have been verified in
their registries.

## Partial-release recovery

### npm succeeded, service failed

Fix the service workflow and rerun it for the same tag. Do not republish npm.

### service succeeded, npm failed before publication

Fix Trusted Publishing or package validation and rerun only the npm workflow.

### npm reports the version already exists

Verify the published package. npm versions are immutable; do not attempt to
replace the same version. Complete the missing service publication or issue a new
patch release.

### incorrect artifact published

Create a corrected patch version. Do not rewrite an existing tag or mutate a
published package/image version.

## Repository settings required

Before the first public release, confirm:

- GitHub Actions are enabled;
- workflow permissions allow GHCR publication;
- `npm-production` and `ghcr-production` environments exist when referenced;
- npm Trusted Publishing targets the exact repository and workflow path;
- the GHCR package inherits or grants the required repository access;
- branch and tag protection rules do not block the intended release actor.
