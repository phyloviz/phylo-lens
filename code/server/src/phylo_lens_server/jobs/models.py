"""Job control values and contracts; no graph algorithms or SQL."""

from collections.abc import Mapping
from concurrent.futures import Future
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Literal, Protocol

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import (
    PreparationSummary,
    PreparedLayoutResult,
)
from phylo_lens_server.domain.sfdp import SfdpOptions

type JSONValue = (
    str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]
)
type FailureDetails = Mapping[str, JSONValue]
PrepareJobStatus = Literal["pending", "ready", "failed"]
JOB_STATUS_PENDING: PrepareJobStatus = "pending"
JOB_STATUS_READY: PrepareJobStatus = "ready"
JOB_STATUS_FAILED: PrepareJobStatus = "failed"
ERR_JOB_CANCELLED = "Layout preparation was cancelled."
ERR_PREPARE_QUEUE_FULL = "Too many graph prepare jobs are already queued or running."


class PrepareQueueFullError(RuntimeError):
    """Admission would exceed the configured active-job limit."""


class LayoutPublicationAbortedError(RuntimeError):
    """Preparation lost ownership before publishing artifacts."""


@dataclass(frozen=True)
class PrepareJob:
    job_id: str
    dataset_id: str
    status: PrepareJobStatus = "pending"


@dataclass(frozen=True)
class PrepareJobSnapshot:
    job_id: str
    status: PrepareJobStatus
    result: PreparationSummary | None = None
    error: str | None = None
    error_details: FailureDetails | None = None
    warnings: tuple[str, ...] = ()


class PrepareWorker(Protocol):
    def submit_prepare_dataset(
        self, dataset: Dataset, *, sfdp_options: SfdpOptions | None = None
    ) -> Future[PreparedLayoutResult]: ...
    def shutdown(self) -> None: ...


class PrepareJobs(Protocol):
    def reserve_capacity(self) -> AbstractContextManager[bool]: ...
    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
        reserved_capacity: bool = False,
    ) -> str: ...
    def snapshot(self, job_id: str) -> PrepareJobSnapshot | None: ...
    def shutdown(self) -> None: ...
