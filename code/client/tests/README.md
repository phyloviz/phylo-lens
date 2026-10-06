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

The navigation and zoom fixtures also need a running graph service and a Newick
fixture. `tests/browser/tsconfig.json` checks these browser fixtures separately.
