import pytest

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.parsers import ParseError, parse_newick
from phylo_lens_server.pipeline.ingest import layout_version_for_dataset
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

PROFILES = "ID\tL1\tL2\nA/01\t1\t2\nB.02\t1\t2\nC\t2\t3\n"
ANCILLARY = (
    "ID\tcountry\tyear\nA/01\tPortugal\t2020\nB.02\tSpain\t2021\nC\tFrance\t2022\n"
)


def grouped_dataset(monkeypatch, **kwargs):
    def convert(content):
        assert content.count("\t1\t2\n") == 2  # Frequency survives the algorithm input.
        return parse_newick("(b_02:0,c:2)a_01;")

    monkeypatch.setattr(
        "phylo_lens_server.data.normalizer.typing_profiles_to_graph", convert
    )
    return normalize_dataset(
        NormalizeRequest(format="typing_data", content=PROFILES, **kwargs)
    ).dataset


def test_profile_membership_and_counts_without_ancillary(monkeypatch):
    dataset = grouped_dataset(monkeypatch)
    assert [node.id for node in dataset.nodes] == ["a_01", "c"]
    assert [(edge.source, edge.target, edge.distance) for edge in dataset.edges] == [
        ("a_01", "c", 2)
    ]
    assert [i.id for i in dataset.isolates_by_node_id["a_01"]] == ["A/01", "B.02"]
    assert dataset.metadata_by_node_id["a_01"]["profile_count"] == 2
    assert dataset.metadata_by_node_id["c"]["profile_count"] == 1
    assert not any(field.key == "profile_count" for field in dataset.metadata_schema)


def test_grouped_metadata_preserves_rows_and_counts(monkeypatch):
    dataset = grouped_dataset(
        monkeypatch, ancillary_data={"content": ANCILLARY, "join_column": "ID"}
    )
    metadata = dataset.metadata_by_node_id["a_01"]
    assert metadata["__category_count__country__value__Portugal"] == 1
    assert metadata["__category_count__country__value__Spain"] == 1
    assert [
        isolate.metadata["year"] for isolate in dataset.isolates_by_node_id["a_01"]
    ] == [2020, 2021]
    assert len(dataset.ancillary_rows_by_node_id["a_01"]) == 2


def test_missing_ancillary_does_not_reduce_profile_frequency(monkeypatch):
    dataset = grouped_dataset(
        monkeypatch,
        ancillary_data={
            "content": "ID\tcountry\nA/01\tPortugal\n",
            "join_column": "ID",
        },
    )
    assert dataset.metadata_by_node_id["a_01"]["profile_count"] == 2
    assert dataset.isolates_by_node_id["a_01"][1].metadata == {}


def test_direct_metadata_overrides_only_its_isolate(monkeypatch):
    dataset = grouped_dataset(
        monkeypatch,
        ancillary_data={"content": ANCILLARY, "join_column": "ID"},
        metadata_by_node_id={"B.02": {"country": "France"}},
    )
    assert [i.metadata["country"] for i in dataset.isolates_by_node_id["a_01"]] == [
        "Portugal",
        "France",
    ]
    assert (
        "__category_count__country__value__Spain"
        not in dataset.metadata_by_node_id["a_01"]
    )


def test_identical_profiles_and_single_isolate_need_no_java(monkeypatch):
    monkeypatch.setattr(
        "phylo_lens_server.data.normalizer.typing_profiles_to_graph",
        lambda *_: pytest.fail("No algorithm needed for one unique profile"),
    )
    for rows in ["A\t1\n", "A\t1\nB\t1\n"]:
        dataset = normalize_dataset(
            NormalizeRequest(format="typing_data", content="ID\tL1\n" + rows)
        ).dataset
        assert len(dataset.nodes) == 1
        assert not dataset.edges
        assert dataset.metadata_by_node_id["a"]["profile_count"] == len(
            rows.splitlines()
        )


@pytest.mark.parametrize(
    "ids", [("A-B", "A/B"), ("A", "a"), ("___", "B"), ("union_1", "B")]
)
def test_ambiguous_identifiers_are_rejected(ids):
    with pytest.raises(ParseError):
        normalize_dataset(
            NormalizeRequest(
                format="typing_data", content=f"ID\tL1\n{ids[0]}\t1\n{ids[1]}\t2\n"
            )
        )


def test_original_membership_changes_layout_fingerprint(monkeypatch):
    dataset = grouped_dataset(monkeypatch)
    changed = dataset.model_copy(deep=True)
    changed.isolates_by_node_id["a_01"][1].id = "different-original-id"
    assert layout_version_for_dataset(dataset) != layout_version_for_dataset(changed)


def test_membership_survives_storage_search_and_viewport(monkeypatch, tmp_path):
    dataset = grouped_dataset(
        monkeypatch, ancillary_data={"content": ANCILLARY, "join_column": "ID"}
    )
    store = PreparedLayoutStore(tmp_path)
    result = PreparedLayoutWorker(store).prepare_dataset(dataset)
    version = result.artifacts.layout_version
    store = PreparedLayoutStore(tmp_path)  # No in-memory normalization state.
    match = store.search_nodes(
        dataset_id=dataset.dataset_id, layout_version=version, query="B.02", limit=10
    )
    assert len(match.matches) == 1
    assert match.matches[0].node_id == "a_01"
    assert match.matches[0].score == 100
    assert match.matches[0].matched_text == "B.02"
    assert match.matches[0].x is not None
    view = store.read_viewport(
        dataset_id=dataset.dataset_id,
        layout_version=version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=20,
        lod_level=999,
    )
    node = next(node for node in view.nodes if node.node_id == "a_01")
    assert node.member_count == 1  # One biological profile, not an LoD cluster.
    assert [i.id for i in node.isolates] == ["A/01", "B.02"]
    assert node.metadata["profile_count"] == 2
    assert node.isolates[1].metadata["country"] == "Spain"
    store.clear_dataset(dataset.dataset_id)
    assert not store.search_nodes(
        dataset_id=dataset.dataset_id, layout_version=version, query="B.02", limit=10
    ).matches


def test_declared_numeric_metadata_keeps_individual_values(monkeypatch):
    dataset = grouped_dataset(
        monkeypatch,
        ancillary_data={"content": ANCILLARY, "join_column": "ID"},
        metadata_schema=[{"key": "year", "type": "number"}],
    )
    assert dataset.metadata_by_node_id["a_01"]["year"] == 2020.5
    assert [
        isolate.metadata["year"] for isolate in dataset.isolates_by_node_id["a_01"]
    ] == [2020, 2021]


def test_original_identifiers_match_literally_after_reopening_store(tmp_path):
    ids = ["00123", "A/01", "B.02", "C D", "E%F", "G_H", "Straße"]
    dataset = normalize_dataset(
        NormalizeRequest(
            format="typing_data",
            content="ID\tL1\n" + "".join(f"{identifier}\t1\n" for identifier in ids),
        )
    ).dataset
    prepared = PreparedLayoutWorker(PreparedLayoutStore(tmp_path)).prepare_dataset(
        dataset
    )
    store = PreparedLayoutStore(tmp_path)
    scope = {
        "dataset_id": dataset.dataset_id,
        "layout_version": prepared.artifacts.layout_version,
        "limit": 10,
    }
    profile = dataset.nodes[0].id
    for identifier in ids:
        result = store.search_nodes(**scope, query=identifier)
        assert result.total_count == 1
        assert result.matches[0].node_id == profile
        assert result.matches[0].score == 100
    for query, score in [
        ("001", 60),
        ("/01", 40),
        ("%", 40),
        ("_", 40),
        ("STRASSE", 100),
    ]:
        result = store.search_nodes(**scope, query=query)
        assert result.total_count == 1
        assert result.matches[0].score == score
    assert not store.search_nodes(**scope, query="EanythingF").matches
