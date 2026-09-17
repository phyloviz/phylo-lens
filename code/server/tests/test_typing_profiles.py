import csv
import json
from io import StringIO
from pathlib import Path

import pytest

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.parsers import ParseError, parse_newick
from phylo_lens_server.data.typing_profiles import prepare_typing_profiles

FIXTURES = Path(__file__).resolve().parents[3] / "examples" / "typing"


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

    def convert(content):
        received.append(content)
        return parse_newick("((iso-B:0)iso-A:1,iso-D:1)iso-C;")

    monkeypatch.setattr(
        "phylo_lens_server.data.normalizer.typing_profiles_to_graph", convert
    )
    result = normalize_dataset(
        NormalizeRequest(
            format="typing_data",
            content=(FIXTURES / "missing-loci.tsv").read_text(),
            ancillary_data={
                "format": "tsv",
                "join_column": "ID",
                "content": (FIXTURES / "missing-loci-ancillary.tsv").read_text(),
            },
        )
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
    assert prepared.warnings == []


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
        "phylo_lens_server.data.normalizer.typing_profiles_to_graph", unexpected_call
    )
    if not content:
        with pytest.raises(ParseError, match=message):
            prepare_typing_profiles(content)
        return
    with pytest.raises(ParseError, match=message):
        normalize_dataset(NormalizeRequest(format="typing_data", content=content))


def test_newick_zero_length_branches_are_not_filtered() -> None:
    result = normalize_dataset(NormalizeRequest(format="newick", content="(A:0,B:1)R;"))
    assert len(result.dataset.nodes) == 3
    assert sorted(edge.distance for edge in result.dataset.edges) == [0, 1]
    assert result.dataset.source.provenance is None
