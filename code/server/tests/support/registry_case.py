"""Child entry point for bounded immediate-Future deadlock regressions."""

import json
import sys

from phylo_lens_server.domain.preparation import PreparedLayoutResult
from phylo_lens_server.jobs.local import PrepareJobRegistry
from tests.support.preparation import weighted_tree as _dataset
from tests.support.prepare_workers import (
    ImmediatelyCompletedPrepareWorker,
    ImmediatelyFailedPrepareWorker,
)


def registry_case(kind: str) -> dict:
    dataset = _dataset().model_copy(update={"dataset_id": f"immediate-{kind}"})
    worker = (
        ImmediatelyCompletedPrepareWorker()
        if kind == "ready"
        else ImmediatelyFailedPrepareWorker()
    )
    registry = PrepareJobRegistry(worker, max_active_jobs=1)

    with registry.reserve_capacity():
        job_id = registry.submit(
            dataset,
            ("submitted warning",),
            reserved_capacity=True,
        )
        active_inside_reservation = registry._active_reservations
        snapshot_inside_reservation = registry.snapshot(job_id)

    snapshot_after_reservation = registry.snapshot(job_id)
    return {
        "active_inside_reservation": active_inside_reservation,
        "active_after_reservation": registry._active_reservations,
        "job_id": job_id,
        "status_inside_reservation": (
            None
            if snapshot_inside_reservation is None
            else snapshot_inside_reservation.status
        ),
        "status_after_reservation": (
            None
            if snapshot_after_reservation is None
            else snapshot_after_reservation.status
        ),
        "result_retained": (
            None
            if snapshot_after_reservation is None
            else isinstance(snapshot_after_reservation.result, PreparedLayoutResult)
        ),
        "result_payload": (
            None
            if snapshot_after_reservation is None
            or snapshot_after_reservation.result is None
            else snapshot_after_reservation.result.model_dump(mode="json")
        ),
        "error": (
            None
            if snapshot_after_reservation is None
            else snapshot_after_reservation.error
        ),
    }


if __name__ == "__main__":
    print(json.dumps(registry_case(sys.argv[1])))
