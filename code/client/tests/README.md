# Client tests

Run `npm test` from `code/client`. It checks the test types before running Vitest.
The compile-time checks in `immutability.test-d.ts` fail if readonly contracts or
the separation between DTOs and application models are weakened.

Test observable behavior: state transitions, data ownership, stale requests,
filtering, ancillary distributions and renderer lifecycle. Keep DTO fixtures in
service tests; application tests use camelCase models and branded identifiers.
Use typed mocks for the methods a collaborator actually needs.

`freezeInput` is for small, plain test fixtures. It helps detect accidental writes
to reducer inputs and graph calculations. It does not imply that production
graphs should be recursively frozen.

Browser smoke scripts use the Playwright dependency in `eval/browser`. Install
that project's dependencies and Chromium before running the scripts. For example:

```sh
node tests/browser/elasticMotion.mjs
node tests/browser/viewportReadability.mjs
```

`node tests/browser/meetingRequirements.mjs` verifies manual collapse/expand,
distance-label intervals, grayscale edges, palette reset and lifecycle, removal
of the redundant node selector, and real pointer-driven branch dragging against
the product UI. Start a local API service first; `REQUIREMENTS_API_URL` defaults
to `http://127.0.0.1:8128`. Use an isolated service data directory. The script
creates and closes its own Vite server and browser, and writes a screenshot to
`REQUIREMENTS_SCREENSHOT` (default `phylo-lens-requirements.png` in the system
temporary directory).

The navigation and zoom fixtures also need a running graph service and a Newick
fixture. `tests/browser/tsconfig.json` checks these browser fixtures separately.
