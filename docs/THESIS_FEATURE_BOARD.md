# Thesis Feature Board

This file tracks thesis-facing implementation work in a lightweight way.

## Active Tickets

| ID          | Title                                                     | Status      | Priority | Notes |
| ----------- | --------------------------------------------------------- | ----------- | -------- | ----- |
| BUG-PL-001  | Fix CI instability / failing pipeline paths               | In Progress | P1       | Client TypeScript build issue identified in CI. |
| PERF-PL-002 | Improve parser scalability for large Newick inputs        | In Review   | P1       | Streaming parser path now implemented. |
| TASK-PL-003 | Freeze hierarchy and visible-slice contracts for LoD      | In Progress | P0       | Contract-first step for semantic zoom architecture. |
| TASK-PL-004 | Implement tree hierarchy precompute MVP for LoD engine    | Backlog     | P0       | Depends on `TASK-PL-003`. |

## Recommended Order

1. `TASK-PL-003` Freeze hierarchy and visible-slice contracts.
2. `TASK-PL-004` Implement deterministic hierarchy precompute.
3. `TASK-PL-005` Build visible-slice selector MVP.
4. `TASK-PL-006` Expose LoD query endpoint.
5. `TASK-PL-007` Switch client workbench to visible-slice rendering.

## Notes

- Large-scale rendering is based on server-driven visible subsets, not full
  topology transfer.
- Parser and normalizer optimizations are valuable, but they are no longer the
  primary scaling story once LoD infrastructure becomes active.
