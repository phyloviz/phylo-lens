import pytest

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import (
    PreparationSummary,
    PreparedLayoutResult,
)
from phylo_lens_server.domain.sfdp import (
    SfdpOptions,
)
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.jobs.local import (
    PrepareJobRegistry,
    PrepareQueueFullError,
)
from phylo_lens_server.pipeline.lod import prepare_layout_artifacts
from phylo_lens_server.services import preparation as graph_service
from tests.support.preparation import FORMAT_NEWICK, WEIGHTED_TREE
from tests.support.preparation import varied_chain_dataset as _varied_chain_dataset
from tests.support.preparation import weighted_tree as _dataset
from tests.support.prepare_workers import RecordingPrepareWorker
from tests.support.registry_process import (
    immediate_future_case as _immediate_future_registry_case,
)


def _prepared_result(dataset: Dataset) -> PreparedLayoutResult:
    return PreparedLayoutResult(artifacts=prepare_layout_artifacts(dataset))


def test_prepare_job_reuse_is_scoped_to_sfdp_layout_version() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()
    first_options = SfdpOptions(k=0.5)

    first_job_id = registry.submit(dataset, sfdp_options=first_options)
    reused_job_id = registry.submit(dataset, sfdp_options=first_options)
    changed_job_id = registry.submit(dataset, sfdp_options=SfdpOptions(k=0.75))

    assert reused_job_id == first_job_id
    assert changed_job_id != first_job_id
    assert worker.submitted_sfdp_options == [first_options, SfdpOptions(k=0.75)]


def test_prepare_job_registry_coalesces_duplicate_in_flight_layouts() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)

    first_job_id = registry.submit(_dataset())
    second_job_id = registry.submit(_dataset())

    assert second_job_id == first_job_id
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_accepts_already_completed_future() -> None:
    result = _immediate_future_registry_case("ready")

    assert result["job_id"]
    assert result["active_inside_reservation"] == 1
    assert result["active_after_reservation"] == 0
    assert result["status_inside_reservation"] == "ready"
    assert result["status_after_reservation"] == "ready"
    assert result["result_retained"] is False
    assert result["result_payload"] is not None
    assert result["result_payload"]["dataset_id"] == "immediate-ready"
    assert "submitted warning" in result["result_payload"]["warnings"]


def test_prepare_job_registry_accepts_already_failed_future() -> None:
    result = _immediate_future_registry_case("failed")

    assert result["job_id"]
    assert result["active_inside_reservation"] == 1
    assert result["active_after_reservation"] == 0
    assert result["status_inside_reservation"] == "failed"
    assert result["status_after_reservation"] == "failed"
    assert result["result_retained"] is False
    assert result["result_payload"] is None
    assert "layout failed immediately" in result["error"]


def test_prepare_job_registry_reuses_completed_successful_layout_jobs() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    first_job_id = registry.submit(dataset)
    worker.futures[0].set_result(_prepared_result(dataset))
    second_job_id = registry.submit(dataset)

    assert second_job_id == first_job_id
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_drops_completed_future_result_after_payload_capture() -> (
    None
):
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    job_id = registry.submit(dataset, ("submitted warning",))
    worker.futures[0].set_result(_prepared_result(dataset))
    snapshot = registry.snapshot(job_id)
    duplicate_job_id = registry.submit(dataset)

    assert duplicate_job_id == job_id
    assert snapshot is not None
    assert snapshot.status == "ready"
    assert not isinstance(snapshot.result, PreparedLayoutResult)
    assert snapshot.result.model_dump(mode="json") == PreparationSummary.from_result(
        _prepared_result(dataset),
        ("submitted warning",),
    ).model_dump(mode="json")
    assert job_id not in registry._futures


def test_prepare_job_registry_retries_failed_layout_jobs() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()

    first_job_id = registry.submit(dataset)
    worker.futures[0].set_exception(RuntimeError("layout failed"))
    second_job_id = registry.submit(dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


def test_prepare_job_registry_does_not_coalesce_changed_dataset_content() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "same-name"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "same-name"}
    )

    first_job_id = registry.submit(first_dataset)
    second_job_id = registry.submit(second_dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


def test_prepare_job_registry_rejects_new_work_at_active_limit() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(
        worker,
        max_active_jobs=1,
    )
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "limited"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "limited"}
    )

    first_job_id = registry.submit(first_dataset)
    duplicate_job_id = registry.submit(first_dataset)

    assert duplicate_job_id == first_job_id
    with pytest.raises(PrepareQueueFullError):
        registry.submit(second_dataset)
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_reserves_capacity_before_dataset_submission() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with registry.reserve_capacity():
        with pytest.raises(PrepareQueueFullError), registry.reserve_capacity():
            pass
        job_id = registry.submit(_dataset(), reserved_capacity=True)

    assert registry.snapshot(job_id).status == "pending"
    assert len(worker.submitted_datasets) == 1


def test_prepare_job_registry_releases_capacity_reservation_on_failure() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with pytest.raises(RuntimeError), registry.reserve_capacity():
        raise RuntimeError("normalization failed")

    with registry.reserve_capacity():
        pass


def test_prepare_graph_job_reserves_capacity_before_normalization(monkeypatch) -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker, max_active_jobs=1)
    normalized = False

    def fake_normalize(*args, **kwargs):
        nonlocal normalized
        normalized = True
        raise AssertionError("normalization should not run when capacity is full")

    monkeypatch.setattr(graph_service, "ingest_dataset", fake_normalize)

    with registry.reserve_capacity(), pytest.raises(PrepareQueueFullError):
        graph_service.prepare_graph_job(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name="reserved",
                content=WEIGHTED_TREE,
            ),
            registry,
        )

    assert normalized is False


def test_prepare_job_registry_allows_new_work_after_active_job_completes() -> None:
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(
        worker,
        max_active_jobs=1,
    )
    first_dataset = _varied_chain_dataset(5).model_copy(
        update={"dataset_id": "limited"}
    )
    second_dataset = _varied_chain_dataset(6).model_copy(
        update={"dataset_id": "limited"}
    )

    first_job_id = registry.submit(first_dataset)
    worker.futures[0].set_result(_prepared_result(first_dataset))
    second_job_id = registry.submit(second_dataset)

    assert second_job_id != first_job_id
    assert len(worker.submitted_datasets) == 2


def test_prepare_job_reuse_and_worker_use_the_requested_lod_policy():
    worker = RecordingPrepareWorker()
    registry = PrepareJobRegistry(worker)
    dataset = _dataset()
    policy = LodOptions(small_component_threshold=32)
    first = registry.submit(dataset, lod_options=policy)
    assert registry.submit(dataset, lod_options=policy) == first
    assert (
        registry.submit(dataset, lod_options=LodOptions(small_component_threshold=128))
        != first
    )
    assert worker.submitted_lod_options == [
        policy,
        LodOptions(small_component_threshold=128),
    ]
