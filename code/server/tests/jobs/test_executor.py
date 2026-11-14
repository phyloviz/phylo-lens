from phylo_lens_server.jobs.executor import PrepareExecutor
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.preparation import DATASET_ID
from tests.support.preparation import weighted_tree as _dataset


def test_prepare_executor_can_run_on_background_thread(tmp_path) -> None:
    store = SQLiteLayoutRepository(tmp_path)
    worker = PrepareExecutor(PreparationService(store))

    try:
        future = worker.submit_prepare_dataset(_dataset())
        result = future.result(timeout=10)
    finally:
        worker.shutdown()

    assert result.artifacts.dataset.dataset_id == DATASET_ID
    assert store.load_node_positions(DATASET_ID, result.artifacts.layout_version)
