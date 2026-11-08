"""Controlled Future completion at the preparation-worker boundary."""

from concurrent.futures import Future

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import (
    PreparedLayoutResult,
)
from phylo_lens_server.domain.sfdp import (
    SfdpOptions,
)
from phylo_lens_server.pipeline.lod import (
    prepare_layout_artifacts,
)


class RecordingPrepareWorker:
    def __init__(self) -> None:
        self.submitted_datasets: list[Dataset] = []
        self.submitted_sfdp_options: list[SfdpOptions | None] = []
        self.submitted_lod_options: list[LodOptions | None] = []
        self.futures: list[Future[PreparedLayoutResult]] = []

    def submit_prepare_dataset(
        self,
        dataset: Dataset,
        *,
        sfdp_options: SfdpOptions | None = None,
        lod_options: LodOptions | None = None,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        self.submitted_datasets.append(dataset)
        self.submitted_sfdp_options.append(sfdp_options)
        self.submitted_lod_options.append(lod_options)
        self.futures.append(future)
        return future

    def shutdown(self) -> None:
        pass


class ImmediatelyCompletedPrepareWorker:
    def submit_prepare_dataset(
        self,
        dataset: Dataset,
        *,
        sfdp_options: SfdpOptions | None = None,
        lod_options: LodOptions | None = None,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        future.set_result(
            PreparedLayoutResult(
                artifacts=prepare_layout_artifacts(
                    dataset,
                    sfdp_options=sfdp_options,
                    lod_options=lod_options,
                )
            )
        )
        return future

    def shutdown(self) -> None:
        pass


class ImmediatelyFailedPrepareWorker:
    def submit_prepare_dataset(
        self,
        dataset: Dataset,
        *,
        sfdp_options: SfdpOptions | None = None,
        lod_options: LodOptions | None = None,
    ) -> Future[PreparedLayoutResult]:
        future: Future[PreparedLayoutResult] = Future()
        future.set_exception(RuntimeError("layout failed immediately"))
        return future

    def shutdown(self) -> None:
        pass
