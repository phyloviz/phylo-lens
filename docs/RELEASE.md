# Releasing PhyloLens

Use **Actions → Prepare release → Run workflow** on `main`, choose `patch`,
`minor`, or `major`, and review the generated release PR. Edit `RELEASE_NOTES.md`
in that PR if needed. **Merge after CI passes** to start publication automatically.
There is no need to edit package versions, create tags, or publish a GitHub release
by hand. Preparing a PR does not publish anything.

`VERSION` is the release authority. The preparation script updates the npm package,
its two lockfile version fields, Python package, service fallback, Docker default,
and Compose image together. The API contract version remains independent.
Existing stable tags are reserved, including failed releases: with `VERSION=0.2.2`
and the failed public tag `v0.2.3`, the next patch is `0.2.4`.

## What happens after merging

The coordinated **Release** workflow keeps the filename `release-npm.yml` to
preserve the existing npm Trusted Publishing identity. The old independent
service publication workflow has been removed.

1. Resolve an exact commit on `main` and validate every version declaration.
2. Call the same CI workflow used by PRs, with every check enabled: client
   formatting/lint/tests/build, server validation, evaluation smokes, packed-package
   consumer, and native AMD64 and ARM64 container builds and smoke tests.
3. Pack the library once and build an external consumer against that exact
   tarball. Check production npm dependencies for high/critical advisories.
4. Save both smoke-tested container images and the npm tarball as immutable
   workflow artifacts. Download them again and reload both saved images to verify
   the artifact handoff and image identities. No publication credentials are
   available to these jobs.
5. Create the release tag, or verify that a retry's tag still identifies the
   validated commit. Never move a tag.
6. Publish the saved npm tarball through OIDC and the saved container images using
   `GITHUB_TOKEN`. These jobs install no application dependencies or rebuild code.
7. Verify npm's SHA-512 package integrity and the exact Docker image configuration
   digests for both platforms. Assemble the multi-platform image from immutable
   manifest digests.
8. After both publications succeed, promote the Docker aliases and publish the
   GitHub release with the reviewed notes.

Both registries are independent: an interruption can still leave one artifact
published. The workflow does not claim a complete GitHub release until both are
verified. Versioned Docker tags (`X.Y.Z`, `X.Y.Z-amd64`, `X.Y.Z-arm64`) must never
be overwritten with different images. Floating aliases are `latest`, `X.Y`, and
`X`. Older recovery runs cannot move aliases backwards.

All release versions share a non-cancelling concurrency group. Keep one release
PR open at a time and finish or recover its release before preparing another.
GitHub may replace a queued pending run if several releases are started together;
recover a superseded release explicitly if necessary.

## CI and safe rehearsal

Normal PR CI retains path filtering. Version consistency and release safeguard
tests always run inside the already-required **Detect changes** job. A version
failure therefore blocks merging under the existing main ruleset. Workflow, script, or VERSION changes select all affected checks.
The final **CI required** check fails if any selected check fails or is cancelled.
Existing check names remain compatible with the current main ruleset.

Use **Actions → CI → Run workflow**, select the branch, and enable **release** to
rehearse all release validation and retain the exact artifacts. This workflow has
no registry publication credentials and never publishes. The same can be run with:

```bash
gh workflow run ci.yml --ref YOUR_BRANCH -f release=true
```

Local release tooling checks require Python 3.12+:

```bash
python -m unittest discover -s scripts/tests -v
python scripts/check-release-version.py
```

For local version preparation, fetch tags first, then run:

```bash
git fetch origin --tags
python scripts/release_version.py prepare patch
```

The command changes files only. The GitHub preparation workflow additionally
creates release notes, commits the edits, opens a PR, and explicitly dispatches CI.
This avoids relying on workflow runs being triggered by bot-created pushes.

## One-time repository and npm setup

GitHub protections applied on 16 October 2026: read-only default Actions tokens,
main-only production environments, required **CI required** status on main, and
protection against release tag deletion and updates. Keep these protections enabled.

Before the first coordinated release:

- In GitHub Actions settings, allow Actions to create pull requests. This is
  already enabled for this repository. Prefer a **read-only default token**;
  workflows grant write access only to the jobs that need it.
- Keep the `npm-production` and `ghcr-production` environments. Restrict their
  deployment branches to **main only**. Publication runs on main even though its
  source is an immutable tag/commit. Add reviewers if the team wants a separate
  approval after the release PR review.
- Keep **CI required** as a required main status check. It is already enabled.
  Existing individual required checks remain in place.
- Protect `v*` tags against deletion and force updates with a tag ruleset.
- On npm, verify the trusted publisher for `@phyloviz/phylo-lens`: organization
  `phyloviz`, repository `phylo-lens`, workflow **release-npm.yml** (filename only),
  environment **npm-production**, with direct `npm publish` allowed. The workflow
  needs no `NPM_TOKEN`; remove obsolete tokens after the first successful OIDC
  publication. npm CLI 11.5.1+ and Node 22.14+ are required; the workflow uses Node 24.
- Confirm GHCR grants this repository package write access. The existing setup
  already published previous versions using its repository token.

CI and release runners use explicit Ubuntu 24.04 labels (including native ARM64),
so an ubuntu-latest migration cannot silently change the validation environment.
All third-party actions are pinned to immutable commit hashes. Dependabot proposes
weekly action updates as reviewable PRs. Release builds do not reuse dependency or
Docker build caches, and artifact downloads fail if digest verification fails.

Official references: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
and [Docker artifact sharing](https://docs.docker.com/build/ci/github-actions/share-image-jobs/).

## Evaluation failure diagnostics

During validation, the existing RQ3 headless paired smoke failed intermittently in
one run while the same source passed other CI/rehearsal runs. Its pass criteria
remain unchanged. CI now preserves failed evaluation test directories (browser
logs, observations and screenshots) for seven days, and the smoke assertion prints
the failing observation. A recurrence blocks release and can be investigated from
the `evaluation-failure-*` artifact; it is not automatically retried or ignored.

## Recovery

Open the original **Release** run and choose **Re-run failed jobs**. Successful
validation jobs retain their exact artifacts for **seven days**. npm publication
is skipped only when the existing package has identical integrity; Docker
publication is skipped only when both image identities match. Authentication,
network, throttling, and registry errors fail the workflow instead of being
interpreted as an absent version.

Do not use **Re-run all jobs** to recover a partial publication: that rebuilds
artifacts, and rebuilding the same source can resolve different upstream packages.
A retry must publish the originally tested artifacts.

If the original run was superseded or artifacts expired, **Actions → Release → Run
workflow**, on **main**, accepts an existing `vX.Y.Z` tag. The workflow verifies
that the tag belongs to main and validates its exact commit again. If newly built
artifacts differ from a version already published, recovery stops safely. Prepare
a new patch release instead of overwriting the old version. Manual recovery is
for releases created with this pipeline; legacy tags lack its helpers/artifacts.

If a release code fix is needed, fix main and prepare a new patch. Never delete,
move, or reuse `v0.2.3`; it remains the record of the failed manual release.
Introducing VERSION when this pipeline first merges does not republish `0.2.2`.
The first release starts only when a subsequent release PR increases VERSION.
