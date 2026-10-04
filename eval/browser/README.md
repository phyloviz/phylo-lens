# RQ2 browser child

This Node child is the bounded browser executor for RQ2, not a general
benchmarking framework. Build the public client package first, then install
pinned dependencies and Chromium: `npm ci && npx playwright install chromium`.

`node src/runner.mjs control.json result.json` runs replay, page, Chromium and
the public `createPhyloLensView` API through `load()` and two animation frames.
It writes exactly one final JSON result to stdout; stage logs and browser details
go to stderr. Python supplies per-repetition artifact paths and owns manifests,
RSS sampling, schema validation, and statistics. After Chromium launches the
child atomically writes its runtime state, including PID and endpoints, so
Python measures Chromium rather than Node or Python.

The child records `view.load()` through a double rAF opportunity, takes CDP heap
snapshots where supported, then samples rAF intervals during deterministic
Playwright canvas input. It rejects external network traffic and malformed replay
responses. The pilot fixed-fixture replay permits camera-driven viewport refreshes:
these return the same nodes, edges and positions and their count remains recorded
in every observation. The result records `camera_viewport_policy` explicitly.
Camera frame intervals therefore include loopback refresh/application work; they
are not a renderer-only measurement. Other protocols retain their own request
pattern checks, and the validity helper rejects post-initial refreshes by default.
The loopback replay API is
an API contract fixture, never a server-performance measurement. Headless mode
is for smoke validation only; final runs should be headed and recorded.
