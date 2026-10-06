"""Local execution resources; preparation itself is an application service."""

from concurrent.futures import Future, ThreadPoolExecutor

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import PreparedLayoutResult
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.services.preparation import PreparationService


class PrepareExecutor:
    def __init__(
        self,
        preparation: PreparationService,
        executor: ThreadPoolExecutor | None = None,
    ) -> None:
        self.preparation = preparation
        self._executor = executor
        self._owns_executor = executor is None

    def submit_prepare_dataset(
        self, dataset: Dataset, *, sfdp_options: SfdpOptions | None = None
    ) -> Future[PreparedLayoutResult]:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1)
        return self._executor.submit(
            self.preparation.prepare_dataset, dataset, sfdp_options=sfdp_options
        )

    def shutdown(self) -> None:
        if self._owns_executor and self._executor is not None:
            self._executor.shutdown(wait=True)
