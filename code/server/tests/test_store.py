from phylo_lens_server.clustering.hierarchy import build_tree_hierarchy
from phylo_lens_server.core.models import PreparedDatasetRecord
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.store import DatasetStore

FORMAT_NEWICK = "newick"
DATASET_ID = "store-tree"
NEWICK_CONTENT = "((A,B)X,(C,D)Y)Root;"


def test_dataset_store_persists_and_reloads_prepared_record(tmp_path) -> None:
    """Ensure prepared datasets survive a fresh store instance via disk persistence."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_ID,
            content=NEWICK_CONTENT,
        )
    ).dataset
    hierarchy = build_tree_hierarchy(dataset)
    record = PreparedDatasetRecord(dataset=dataset, hierarchy=hierarchy)

    first_store = DatasetStore(tmp_path)
    first_store.save(record)

    second_store = DatasetStore(tmp_path)
    loaded = second_store.load(DATASET_ID)

    assert loaded is not None
    assert loaded.model_dump() == record.model_dump()
