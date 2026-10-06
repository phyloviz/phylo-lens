"""Real PostgreSQL checks, isolated in a disposable schema on a test DSN."""

import os
from dataclasses import replace
from uuid import uuid4

import pytest

from phylo_lens_server.database import postgres
from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.jobs.durable import DurablePrepareJobRegistry
from phylo_lens_server.pipeline import layout
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.jobs.postgres import PostgresPrepareJobStore
from phylo_lens_server.repository.layout import postgres_layout_repository
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService


@pytest.fixture
def stores(monkeypatch):
    dsn = os.environ.get("PHYLO_LENS_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.skip(
            "A dedicated PHYLO_LENS_TEST_POSTGRES_DSN is required for real-engine checks."
        )
    psycopg = pytest.importorskip("psycopg")
    schema = "phylolens_refactor_test_" + uuid4().hex
    with psycopg.connect(dsn) as connection:
        connection.execute(f'create schema "{schema}"')

    def connect(_dsn):
        return psycopg.connect(
            dsn, options="-c search_path=" + schema, row_factory=psycopg.rows.dict_row
        )

    monkeypatch.setattr(postgres, "connect", connect)
    monkeypatch.setattr(postgres_layout_repository, "connect", connect)
    jobs = PostgresPrepareJobStore(dsn)
    try:
        jobs.create_schema()
        jobs.assert_schema_current()
        yield PostgresLayoutRepository(dsn), jobs
    finally:
        with psycopg.connect(dsn) as connection:
            connection.execute(f'drop schema "{schema}" cascade')


def test_postgres_preparation_reads_and_transactional_replacement(stores, monkeypatch):
    from phylo_lens_server.domain.revisions import AncillaryTable, AncillaryUpdate
    from phylo_lens_server.services.ancillary import apply_ancillary_data

    store, _ = stores
    monkeypatch.setattr(
        layout,
        "compute_global_node_positions",
        lambda dataset, options: {
            node.id: (float(i), 0.0) for i, node in enumerate(dataset.nodes)
        },
    )
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="postgres-contract",
            content="(((A:1,B:2)X:3,C:4)Y:5,D:6)R;",
        ).to_domain(),
        include_summary_schema=True,
    ).dataset
    result = PreparationService(store).prepare_dataset(dataset)
    base = {
        "dataset_id": dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
    }
    assert store.latest_layout_version(dataset.dataset_id) == base["layout_version"]
    for level in {cluster.lod_level for cluster in result.artifacts.clusters}:
        view = store.read_viewport(
            **base, xmin=None, xmax=None, ymin=None, ymax=None, lod_level=level
        )
        ids = {node.node_id for node in view.nodes}
        assert all(edge.source in ids and edge.target in ids for edge in view.edges)
        assert (
            len(view.nodes)
            == store.viewport_representation_counts(
                **base, xmin=None, xmax=None, ymin=None, ymax=None
            )[level]
        )
    assert store.search_nodes(**base, query="A", limit=1).matches[0].node_id == "a"
    region = store.read_region(**base, xmin=0, xmax=2, ymin=0, ymax=0)
    ids = {node.node_id for node in region.nodes}
    assert all(edge.source in ids and edge.target in ids for edge in region.edges)
    replacement = AncillaryUpdate(
        dataset.dataset_id,
        base["layout_version"],
        AncillaryTable("id,country\nA,PT\nB,ES\n", "id"),
    )
    updated = apply_ancillary_data(replacement, store)
    assert (
        apply_ancillary_data(replacement, store).layout_version
        == updated.layout_version
    )
    assert store.load_node_positions(dataset.dataset_id, updated.layout_version) == [
        replace(node, layout_version=updated.layout_version)
        for node in result.node_positions
    ]


def test_postgres_reuse_and_lease_ownership(stores):
    _, store = stores
    dataset = ingest_dataset(
        NormalizeRequest(format="newick", content="(a,b)r;").to_domain()
    ).dataset
    registry = DurablePrepareJobRegistry(store, max_active_jobs=1)
    job_id = registry.submit(dataset)
    assert registry.submit(dataset) == job_id
    claimed = store.claim_next(worker_id="first", lease_seconds=30)
    assert claimed.job_id == job_id
    assert store.heartbeat(job_id=job_id, worker_id="first", lease_seconds=30)
    assert not store.mark_failed(job_id=job_id, worker_id="other", error="wrong owner")
    with store._connect() as connection:
        connection.execute(
            "update prepare_jobs set lease_expires_at = now() - interval '1 second' where job_id = %s",
            (job_id,),
        )
    assert store.claim_next(worker_id="second", lease_seconds=30).job_id == job_id
    assert not store.heartbeat(job_id=job_id, worker_id="first", lease_seconds=30)
    summary = PreparationSummary(
        dataset_id=dataset.dataset_id,
        layout_version=layout_version_for_dataset(claimed.dataset),
        node_count=3,
        edge_count=2,
        cluster_count=1,
        layout_status="ready",
    )
    assert not store.mark_ready(job_id=job_id, worker_id="first", result=summary)
    assert store.mark_ready(job_id=job_id, worker_id="second", result=summary)
    assert registry.snapshot(job_id).result == summary
