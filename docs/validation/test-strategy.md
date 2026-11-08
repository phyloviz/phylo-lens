# Tests that earn their maintenance cost

Keep a test when it protects a meaningful result, failure, ownership rule or
published contract. Its expected result should be independent enough to catch a
plausible defect. A correct internal refactor should usually leave it unchanged.
Test count and line coverage alone do not establish confidence.

## Decisions

- PostgreSQL concurrency runs on the real engine in CI. Independent transactions
  check locked-job claims, layout reuse and capacity. A configured run fails if
  its DSN or driver is missing; local runs without a DSN may skip it. Each test
  uses a disposable schema. Schema validation must reject missing/outdated
  schemas without initializing or repairing them, including inside read-only transactions.
- Browser readiness uses real animation, transition and worker completion, plus
  the geometry being checked. Renderer observation delegates to the real factory.
  Timed wheel input remains intentional. No-motion checks sample an observation
  window; an eventual-success check would weaken that guarantee.
- Stateful doubles own their camera, settings, listeners, worker frames and
  recordings per instance. Reusable factories create fresh state. Keep scenario
  data and expected results in each test; use real pure calculations and parsers.
- CI selects real load/search/fold/drag/export acceptance, distance operations,
  worker settling, collision clearance and camera stability. The larger forest
  and deep-tree walkthrough remains separately runnable.

Removed checks inspected bytecode for locks/DDL, repeated a no-assertion renderer
smoke, preserved obsolete internal module names, or duplicated an undiscovered
evaluation suite. Their replacements exercise transactions and lifecycle behavior.
The timeout test now counts real process launches. The large-chain test checks
every node, finite positions and complete cluster layout coverage; speed belongs
in a benchmark. Public contracts, scientific-data oracles, architectural dependency
rules, stale-request handling and release safeguards remain covered.

## Basis and limits

Gerard Meszaros, *xUnit Test Patterns* (2007), describes fresh fixtures and the
maintenance costs of test coupling. Fowler's
[Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html)
distinguishes test doubles and discusses implementation coupling;
[Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html)
addresses isolation, asynchronous completion, time and resource cleanup.
These principles guide the choices above; they do not prescribe a target number
of tests or establish that a passing suite catches every defect.

A focused mutation experiment removed submit serialization in a separate Python
process. The capacity test rejected the resulting multiple admissions. This is
evidence for that check, not a general mutation score for the suite.

For local PostgreSQL checks, install `code/server` with `[test,dev,postgres]`, set
`PHYLO_LENS_TEST_POSTGRES_DSN` to a dedicated test database and run
`pytest tests/test_postgres_integration.py`. Set `PHYLO_LENS_REQUIRE_POSTGRES=1`
to treat a missing DSN as a failure. Do not use a production database.
