from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import PreparedDatasetRecord
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.store import DatasetStore

FORMAT_EDGELIST = "edgelist"
DATASET_ID = "store-tree"
DATASET_COPY_ID = "store-tree-copy"
PREPARE_FINGERPRINT = "abc123"
WEIGHTED_EDGELIST_CONTENT = "source,target,distance\na,b,1\nb,c,2\n"


def test_dataset_store_persists_and_reloads_prepared_record(tmp_path) -> None:
    """Ensure prepared datasets survive a fresh store instance via disk persistence."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_ID,
            content=WEIGHTED_EDGELIST_CONTENT,
        )
    ).dataset
    hierarchy = build_threshold_hierarchy(dataset)
    record = PreparedDatasetRecord(dataset=dataset, hierarchy=hierarchy)

    first_store = DatasetStore(tmp_path)
    first_store.save(record)

    second_store = DatasetStore(tmp_path)
    loaded = second_store.load(DATASET_ID)

    assert loaded is not None
    assert loaded.model_dump() == record.model_dump()


def test_dataset_store_persists_prepare_cache_by_fingerprint(tmp_path) -> None:
    """Ensure prepared content cache survives store instances and retargets ids."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_ID,
            content=WEIGHTED_EDGELIST_CONTENT,
        )
    ).dataset
    hierarchy = build_threshold_hierarchy(dataset)
    record = PreparedDatasetRecord(dataset=dataset, hierarchy=hierarchy)

    first_store = DatasetStore(tmp_path)
    first_store.save_prepare_cache(PREPARE_FINGERPRINT, record)

    second_store = DatasetStore(tmp_path)
    loaded = second_store.load_prepare_cache(
        PREPARE_FINGERPRINT,
        dataset_id=DATASET_COPY_ID,
    )

    assert loaded is not None
    assert loaded.dataset.dataset_id == DATASET_COPY_ID
    assert loaded.hierarchy.dataset_id == DATASET_COPY_ID
    assert record.dataset.dataset_id == DATASET_ID


def test_dataset_store_ignores_invalid_persisted_dataset_record(tmp_path) -> None:
    """Ensure stale incompatible dataset JSON does not bubble into API 500s."""
    store = DatasetStore(tmp_path)
    path = store._path_for_dataset_id(DATASET_ID)
    path.write_text('{"dataset": {}, "hierarchy": {}}', encoding="utf-8")

    loaded = store.load(DATASET_ID)

    assert loaded is None
    assert not path.exists()


def test_dataset_store_ignores_invalid_prepare_cache_record(tmp_path) -> None:
    """Ensure stale incompatible prepare-cache JSON is treated as a cache miss."""
    store = DatasetStore(tmp_path)
    path = store._path_for_prepare_fingerprint(PREPARE_FINGERPRINT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"dataset": {}, "hierarchy": {}}', encoding="utf-8")

    loaded = store.load_prepare_cache(
        PREPARE_FINGERPRINT,
        dataset_id=DATASET_ID,
    )

    assert loaded is None
    assert not path.exists()
