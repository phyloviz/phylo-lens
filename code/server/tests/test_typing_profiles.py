import csv
import json
from io import StringIO
from pathlib import Path

import pytest

from phylo_lens_server.data.parsers import ParseError, parse_newick_forest
from phylo_lens_server.data.phylolib import RootedTypingTree
from phylo_lens_server.data.typing_profiles import (
    collapse_profile_graph,
    prepare_typing_profiles,
    select_goeburst_root,
    validate_goeburst_tree,
)
from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset

FIXTURES = Path(__file__).resolve().parents[3] / "examples" / "typing"


def _typing_tree(profiles, newick: str, root: str) -> RootedTypingTree:
    parsed = parse_newick_forest(newick)
    distinct = collapse_profile_graph(parsed, profiles.membership())
    validate_goeburst_tree(distinct, profiles.membership())
    return RootedTypingTree(parsed, distinct, root)


def _root_from_matrix(tmp_path, content: str, matrix: str) -> str:
    profiles = prepare_typing_profiles(content)
    path = tmp_path / "matrix.txt"
    path.write_text(matrix, encoding="utf-8")
    return select_goeburst_root(path, profiles, profiles.membership())


def test_missing_loci_fixture_has_expected_global_distances() -> None:
    expected = json.loads((FIXTURES / "missing-loci.expected.json").read_text())
    prepared = prepare_typing_profiles((FIXTURES / "missing-loci.tsv").read_text())
    assert list(prepared.retained_loci) == expected["retained_loci"]
    assert list(prepared.excluded_loci) == expected["excluded_loci"]
    rows = list(csv.reader(StringIO(prepared.content), delimiter="\t"))[1:]
    assert [row[0] for row in rows] == expected["ids"]
    # Independent, hand-checkable Hamming oracle, not the production algorithm.
    distances = [
        [
            sum(a != b for a, b in zip(left[1:], right[1:], strict=True))
            for right in rows
        ]
        for left in rows
    ]
    assert distances == expected["distance_matrix"]
    assert rows[0][1:] == rows[1][1:]
    assert len(rows) == 4  # Preserve IDs and frequency before goeBURST.


def test_normalizer_sends_filtered_matrix_and_records_provenance(monkeypatch) -> None:
    received = []

    def convert(profiles):
        received.append(profiles.algorithm_content())
        return _typing_tree(profiles, "((iso-B:0)iso-A:1,iso-D:1)iso-C;", "iso_a")

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree", convert
    )
    result = ingest_dataset(
        NormalizeRequest(
            format="typing_data",
            content=(FIXTURES / "missing-loci.tsv").read_text(),
            ancillary_data={
                "format": "tsv",
                "join_column": "ID",
                "content": (FIXTURES / "missing-loci-ancillary.tsv").read_text(),
            },
        ).to_domain()
    )
    assert received == [
        "ID\tL1\tL2\niso_a\t1\t2\niso_b\t1\t2\niso_c\t1\t3\niso_d\t2\t3\n"
    ]
    assert json.loads(result.dataset.source.provenance) == {
        "typing_missing_loci_policy": "exclude_loci_with_zero",
        "retained_loci": ["L1", "L2"],
        "excluded_loci": ["L3", "L4"],
    }
    assert len(result.dataset.ancillary_rows_by_node_id) == 3
    assert any("Excluded 2 loci" in warning for warning in result.warnings)
    assert any("L3, L4" in warning for warning in result.warnings)


def test_complete_profiles_preserve_categorical_values_and_ids() -> None:
    content = "ID\tL1\tL2\n001\t01\tA\n002\t1\tB\n"
    prepared = prepare_typing_profiles(content)
    assert prepared.content == content
    assert prepared.excluded_loci == ()
    assert prepared.warnings == ()


def test_bom_crlf_and_surrounding_whitespace_are_normalized() -> None:
    prepared = prepare_typing_profiles("\ufeffID\tL1\tL2\r\nA\t1\t 0 \r\nB\t2\t3\r\n")
    assert prepared.content == "ID\tL1\nA\t1\nB\t2\n"
    assert prepared.excluded_loci == ("L2",)


def test_zero_identifier_is_not_a_missing_allele() -> None:
    assert prepare_typing_profiles("ID\tL1\n0\t1\n").content == "ID\tL1\n0\t1\n"


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("", "requires a TSV header"),
        ("ID\tL1\n", "requires a TSV header"),
        ("ID,L1\nA,1\n", "requires a TSV header"),
        ("ID\tL1\tL1\nA\t1\t2\n", "unique"),
        ("ID\t\nA\t1\n", "non-empty"),
        ("ID\tL1\nA\t1\t2\n", "expected 2"),
        ("ID\tL1\nA\n", "expected 2"),
        ("ID\tL1\nA\t\n", "empty cell"),
        ("ID\tL1\n\t1\n", "empty cell"),
        ("ID\tL1\nA\t1\nA\t2\n", "Duplicate"),
        ("ID\tL1\nA\t0\nB\t1\n", "No comparable loci"),
        ("ID\tL1\tL2\nA\t0\t1\nB\t1\t0\n", "No comparable loci"),
    ],
)
def test_invalid_profiles_fail_before_phylolib(monkeypatch, content, message) -> None:
    def unexpected_call(*args, **kwargs):
        pytest.fail("Invalid profiles must not reach PhyloLib")

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        unexpected_call,
    )
    if not content:
        with pytest.raises(ParseError, match=message):
            prepare_typing_profiles(content)
        return
    with pytest.raises(ParseError, match=message):
        ingest_dataset(
            NormalizeRequest(format="typing_data", content=content).to_domain()
        )


def test_newick_zero_length_branches_are_not_filtered() -> None:
    result = ingest_dataset(
        NormalizeRequest(format="newick", content="(A:0,B:1)R;").to_domain()
    )
    assert len(result.dataset.nodes) == 3
    assert sorted(edge.distance for edge in result.dataset.edges) == [0, 1]
    assert result.dataset.source.provenance is None


def test_direct_newick_preserves_serialized_roots_and_anonymous_nodes() -> None:
    result = ingest_dataset(
        NormalizeRequest(format="newick", content="(A:1,B:1);(C:1,D:1)R;").to_domain()
    )
    assert len(result.dataset.technical_roots) == 2
    assert result.dataset.technical_roots[0].endswith("union_1")
    assert result.dataset.technical_roots[1] == "r"
    assert result.dataset.source.rooting_strategy == "newick-component-root-v1"


def test_goeburst_root_uses_all_profile_distances_not_mst_degree(tmp_path) -> None:
    # Every profile has two SLVs and one DLV. A is first in the input, even
    # though it is a leaf of the MST and the serialized Newick root is B.
    assert (
        _root_from_matrix(
            tmp_path,
            "ID\tL1\tL2\nA\t0a\t0a\nB\t0a\t1a\nC\t1a\t1a\nD\t1a\t0a\n",
            "4\nd\nc\t1\nb\t2\t1\na\t1\t2\t1\n",
        )
        == "a"
    )


def test_goeburst_root_prioritizes_slv_count_over_input_order(tmp_path) -> None:
    # D has three SLVs (B, C, E); it is neither first in the input nor
    # the Newick root.
    assert (
        _root_from_matrix(
            tmp_path,
            "ID\tL1\tL2\tL3\nA\ta\ta\ta\nB\ta\ta\tb\nC\ta\tb\ta\nD\ta\tb\tb\nE\tb\tb\tb\n",
            "5\na\nb\t1\nc\t1\t2\nd\t2\t1\t1\ne\t3\t2\t2\t1\n",
        )
        == "d"
    )


def test_typing_layout_ignores_newick_serialization_root(monkeypatch) -> None:
    content = "ID\tL1\tL2\nA\ta\ta\nB\ta\tb\nC\tb\tb\nD\tb\ta\n"

    def convert_first(profiles):
        return _typing_tree(profiles, "(A:1,(D:1)C:1)B;", "a")

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        convert_first,
    )
    first = ingest_dataset(
        NormalizeRequest(format="typing_data", content=content).to_domain()
    ).dataset
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        lambda profiles: _typing_tree(profiles, "((A:1)B:1,D:1)C;", "a"),
    )
    second = ingest_dataset(
        NormalizeRequest(format="typing_data", content=content).to_domain()
    ).dataset
    assert first.technical_roots == second.technical_roots == ("a",)
    assert first.edges == second.edges
    assert layout_version_for_dataset(first) == layout_version_for_dataset(second)


def test_duplicate_profile_first_occurrence_breaks_final_lv_tie(monkeypatch) -> None:
    # Z appears first but shares A's profile; A is the canonical node ID.
    content = "ID\tL1\tL2\nZ\ta\ta\nB\ta\tb\nC\tb\tb\nD\tb\ta\nA\ta\ta\n"
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        lambda profiles: _typing_tree(profiles, "((Z:0)A:1,(D:1)C:1)B;", "a"),
    )
    dataset = ingest_dataset(
        NormalizeRequest(format="typing_data", content=content).to_domain()
    ).dataset
    assert dataset.technical_roots == ("a",)
    assert {node.id for node in dataset.nodes} == {"a", "b", "c", "d"}


def test_goeburst_root_breaks_slv_ties_using_dlv_counts(tmp_path) -> None:
    # A, B and D each have two SLVs; A alone has two DLVs.
    assert (
        _root_from_matrix(
            tmp_path,
            "ID\tL1\tL2\tL3\nB\ta\tb\ta\nC\ta\tb\tb\nD\tb\ta\ta\nE\tb\ta\tb\nA\ta\ta\ta\n",
            "5\nb\nc\t1\nd\t2\t3\ne\t3\t2\t1\na\t1\t2\t1\t2\n",
        )
        == "a"
    )


def test_duplicate_profiles_count_once_and_use_first_input_occurrence(tmp_path) -> None:
    # Matrix rows need not follow typing order; Z and A are one distinct profile.
    matrix = "5\nd\nc\t1\nb\t2\t1\na\t1\t2\t1\nz\t1\t2\t1\t0\n"
    content = "ID\tL1\tL2\nZ\ta\ta\nB\ta\tb\nC\tb\tb\nD\tb\ta\nA\ta\ta\n"
    assert _root_from_matrix(tmp_path, content, matrix) == "a"
    reordered = "ID\tL1\tL2\nB\ta\tb\nZ\ta\ta\nC\tb\tb\nD\tb\ta\nA\ta\ta\n"
    assert _root_from_matrix(tmp_path, reordered, matrix) == "b"


def test_goeburst_root_rejects_incomplete_matrix(tmp_path) -> None:
    with pytest.raises(ParseError, match="matrix omitted typing profiles"):
        _root_from_matrix(tmp_path, "ID\tL1\nA\t1\nB\t2\n", "2\na\n")


def test_typing_rejects_newick_serialization_junction(monkeypatch) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        lambda profiles: _typing_tree(profiles, "(A:1,B:1);", "a"),
    )
    with pytest.raises(ParseError, match="not typing profiles"):
        ingest_dataset(
            NormalizeRequest(
                format="typing_data", content="ID\tL1\nA\t1\nB\t2\n"
            ).to_domain()
        )


def test_typing_rejects_anonymous_node_even_if_generated_id_matches_profile(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        lambda profiles: _typing_tree(profiles, "((:1,A:1)B:1)C;", "a"),
    )
    with pytest.raises(ParseError, match="not typing profiles"):
        ingest_dataset(
            NormalizeRequest(
                format="typing_data",
                content="ID\tL1\nleaf_1\t1\nA\t2\nB\t3\nC\t4\n",
            ).to_domain()
        )


def test_typing_rejects_a_disconnected_full_mst(monkeypatch) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.ingestion.typing_profiles_to_rooted_tree",
        lambda profiles: _typing_tree(profiles, "A;B;", "a"),
    )
    with pytest.raises(ParseError, match="one connected profile tree"):
        ingest_dataset(
            NormalizeRequest(
                format="typing_data", content="ID\tL1\nA\t1\nB\t2\n"
            ).to_domain()
        )
