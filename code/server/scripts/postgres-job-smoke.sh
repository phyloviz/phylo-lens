#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-phylo-lens-postgres-job-smoke}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
POSTGRES_PORT="${POSTGRES_PORT:-15432}"
POSTGRES_DB="${POSTGRES_DB:-phylo_lens_smoke}"
POSTGRES_USER="${POSTGRES_USER:-phylo_lens}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-phylo_lens_smoke}"
PYTHON_BIN="${PYTHON_BIN:-python}"
export POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

cleanup
docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -p "127.0.0.1:${POSTGRES_PORT}:5432" \
  "$POSTGRES_IMAGE" >/dev/null

trap cleanup EXIT

PYTHONPATH="${PYTHONPATH:+${PYTHONPATH}:}src" "$PYTHON_BIN" - <<'PY'
from __future__ import annotations

import os
import time

try:
    import psycopg
except ImportError as error:
    raise SystemExit(
        "psycopg is required for this smoke test. "
        "Install it with: python -m pip install -e '.[postgres]'"
    ) from error

from phylo_lens_server.domain.preparation import PrepareInput
from phylo_lens_server.domain.models import SourceFormat
from phylo_lens_server.domain.revisions import AncillaryTable, AncillaryUpdate
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.services.ancillary import apply_ancillary_data
from phylo_lens_server.jobs.worker import run_postgres_prepare_worker
from phylo_lens_server.repository.jobs.postgres import (
    DURABLE_STATUS_READY,
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService

dsn = (
    f"postgresql://{os.environ['POSTGRES_USER']}:{os.environ['POSTGRES_PASSWORD']}"
    f"@127.0.0.1:{os.environ['POSTGRES_PORT']}/{os.environ['POSTGRES_DB']}"
)

for _ in range(60):
    try:
        with psycopg.connect(dsn) as connection:
            connection.execute("select 1")
        break
    except psycopg.OperationalError:
        time.sleep(0.5)
else:
    raise SystemExit("Timed out waiting for Postgres smoke container.")

job_store = PostgresPrepareJobStore(dsn)
job_store.create_schema()

normalized = ingest_dataset(
    PrepareInput(
        format=SourceFormat.NEWICK,
        dataset_name="postgres-smoke-tree",
        content="(((d:4)c:2)b:1)a;",
    )
)
job_id = job_store.submit(normalized.dataset, ("postgres smoke warning",))

layout_store = PostgresLayoutRepository(dsn)
run_postgres_prepare_worker(
    job_store=job_store,
    layout_worker=PreparationService(layout_store),
    worker_id="postgres-smoke-worker",
    poll_interval_seconds=0.1,
    lease_seconds=30,
    max_jobs=1,
)

snapshot = job_store.snapshot(job_id)
if snapshot is None:
    raise SystemExit("Postgres smoke job disappeared.")
if snapshot.status != DURABLE_STATUS_READY:
    raise SystemExit(f"Postgres smoke job did not become ready: {snapshot}")
if snapshot.result is None:
    raise SystemExit("Postgres smoke job is ready without a result payload.")
if snapshot.result.dataset_id != "postgres-smoke-tree":
    raise SystemExit(f"Unexpected result payload: {snapshot.result}")
if "postgres smoke warning" not in snapshot.result.warnings:
    raise SystemExit(f"Submit warning was not preserved: {snapshot.result}")

layout_version = snapshot.result.layout_version
viewport = layout_store.read_viewport(
    dataset_id="postgres-smoke-tree",
    layout_version=layout_version,
    xmin=None,
    xmax=None,
    ymin=None,
    ymax=None,
    max_nodes=50,
    lod_level=0,
)
if len(viewport.nodes) != 4 or len(viewport.edges) != 3:
    raise SystemExit(f"Unexpected viewport result: {viewport}")

table = AncillaryTable(
    content="id,country\nb,PT\nc,ES\n", join_column="id", format="csv",
)
request = AncillaryUpdate("postgres-smoke-tree", layout_version, table)
replacement = apply_ancillary_data(request, layout_store)
revision = replacement.layout_version
updated = layout_store.read_viewport(
    dataset_id="postgres-smoke-tree", layout_version=revision,
    xmin=None, xmax=None, ymin=None, ymax=None, max_nodes=50, lod_level=0,
)
assert replacement.matched_node_count == 2
assert {(node.node_id, node.x, node.y) for node in updated.nodes} == {(node.node_id, node.x, node.y) for node in viewport.nodes}
assert next(node for node in updated.nodes if node.node_id == "b").metadata["country"] == "PT"
assert apply_ancillary_data(request, layout_store).layout_version == revision
print("postgres job and ancillary revision smoke ok")
PY
