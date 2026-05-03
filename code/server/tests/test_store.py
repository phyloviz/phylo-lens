from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import PreparedDatasetRecord
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.store import DatasetStore

FORMAT_EDGELIST = "edgelist"
DATASET_ID = "store-tree"
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
