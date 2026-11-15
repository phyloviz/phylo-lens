# Maintaining the documentation website

The HTML manual is built with MkDocs from the canonical Markdown documentation.
The browser and server READMEs become virtual pages during the build; their API
descriptions remain maintained in their original files. A small hook resolves
repository-relative links to published pages or GitHub source files.

## Build and preview

```sh
python -m pip install -r docs/requirements.txt
python -m mkdocs build --strict
python -m mkdocs serve --dev-addr 127.0.0.1:8010
```

The built website is in `site/`, which is ignored by Git. The local development
URL includes the configured `/phylo-lens/` prefix. Navigation, search and images
are static and work on a GitHub Pages project site.
Architecture diagrams use a pinned Mermaid module from jsDelivr. If that module
is unavailable, the original diagram source remains readable.

Internal reviews, feedback notes and validation artifacts are excluded from the
site. Links to tracked supporting evidence resolve to GitHub rather than copying
those directories into the public manual.

## Capture screenshots

The browser capture uses the repository's existing Playwright runtime and the
real application, service and synthetic examples. Install client and evaluation
browser dependencies, start the API, then run:

```sh
cd code/client
REQUIREMENTS_API_URL=http://127.0.0.1:8000 DOC_INCLUDE_TYPING=1 \
  node tests/browser/libraryCompletion.mjs --screenshots
```

Typing screenshots require the configured PhyloLib JAR. Captures are written to
`output/playwright/library-completion/` at the repository root. Inspect them,
then copy the selected PNGs to `docs/assets/screenshots/`. The capture waits for
preparation and renderer completion and also checks actual rerooting behavior.
It does not synthesize application screens or replace inference/layout results.

Keep examples and captions explicit about synthetic observations and distance
units. Update screenshots when controls or visible behavior change. Avoid storing
personal or unpublished research data in documentation assets.

## GitHub Pages

The `documentation.yml` workflow builds the manual in strict mode for pull
requests. Pushes to `main` and manual runs on `main` additionally publish the
static artifact using GitHub Pages. Configure the repository's **Settings →
Pages → Source** as **GitHub Actions** before the first deployment.

The configured project URL is `https://phyloviz.github.io/phylo-lens/`. The site
does not run the Python service; an embedded live viewer would use a separately
deployed API. Screenshots and the complete manual work without that service.
