# Server tests

Run `python -m pytest -q` from `code/server`.

- `preparation/`: LoD, native layout, layout identity, summary aggregation and
  evaluation instrumentation.
- `repository/`: layout publication, viewport/expansion reads, search and regions
  using real temporary SQLite stores.
- `jobs/`: local registry, background execution, durable control and worker
  behavior.
- `support/`: fresh dataset builders, controlled Future workers, the typed
  durable-store recording double and a bounded deadlock subprocess.

Other focused domain, HTTP and PostgreSQL suites remain directly in `tests/`.
The recording double supplies configured results and records calls; it does not
implement database locking or publication. Those behaviors run on real engines.

The immediate-Future child entry point is `tests.support.registry_case`. Its
parent captures stdout, stderr and exit status and enforces a 15-second deadline
including process startup. This protects the runner from a deadlock without
using a platform-specific process start method or a queue timing assumption.

See the [test strategy](../../../docs/validation/test-strategy.md) for PostgreSQL
setup, literature and the limits of this validation.
