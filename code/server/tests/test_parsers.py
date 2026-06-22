import json
import re
from pathlib import Path

import pytest

from phylo_lens_server.data.parsers import ParseError, parse_edgelist, parse_newick

FIXTURES_DIRNAME = "fixtures"
NEWICK_CASES_FILENAME = "newick_cases.json"

FIXTURES_DIR = Path(__file__).parent / FIXTURES_DIRNAME
NEWICK_CASES_PATH = FIXTURES_DIR / NEWICK_CASES_FILENAME


def _load_newick_cases() -> list[dict[str, object]]:
    """Load parser test scenarios from the Newick fixture file."""
    with NEWICK_CASES_PATH.open("r", encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


@pytest.mark.parametrize(
    "case", _load_newick_cases(), ids=lambda case: str(case["name"])
)
def test_parse_newick_fixture_cases(case: dict[str, object]) -> None:
    """Validate Newick parser behavior across valid and invalid fixture scenarios."""
    content = str(case["content"])
    expected_error = case.get("expected_error_contains")

    if expected_error is not None:
        with pytest.raises(ParseError, match=re.escape(str(expected_error))):
            parse_newick(content)
        return

    parsed = parse_newick(content)

    assert len(parsed.nodes) == int(case["expected_node_count"])
    assert len(parsed.edges) == int(case["expected_edge_count"])
    assert len(parsed.warnings) == int(case["expected_warning_count"])

    assert len(parsed.nodes) == len(set(parsed.nodes))
    node_ids = set(parsed.nodes)
    assert all(
        edge.source in node_ids and edge.target in node_ids for edge in parsed.edges
    )


def test_parse_newick_generates_deterministic_ids_for_unlabeled_union_nodes() -> None:
    """Confirm streaming parsing preserves preorder union-node id generation."""
    parsed = parse_newick("((A,B),(C,D));")

    assert set(parsed.nodes) == {
        "union_1",
        "union_2",
        "union_3",
        "a",
        "b",
        "c",
        "d",
    }
    assert {
        (frozenset((edge.source, edge.target)), edge.distance)
        for edge in parsed.edges
    } == {
        (frozenset(("union_1", "union_2")), None),
        (frozenset(("union_1", "union_3")), None),
        (frozenset(("union_2", "a")), None),
        (frozenset(("union_2", "b")), None),
        (frozenset(("union_3", "c")), None),
        (frozenset(("union_3", "d")), None),
    }
    assert parsed.explicit_node_ids == {"a", "b", "c", "d"}


def test_parse_newick_handles_deep_trees_without_recursion() -> None:
    """Confirm deeply nested trees parse without relying on the Python call stack."""
    depth = 5000
    content = f'{"(" * depth}A{")" * depth};'

    parsed = parse_newick(content)

    assert len(parsed.nodes) == depth + 1
    assert len(parsed.edges) == depth
    assert "a" in parsed.nodes
    assert "union_1" in parsed.nodes
    assert parsed.explicit_node_ids == {"a"}
    assert ("union_1", "union_2", None) in {
        (edge.source, edge.target, edge.distance) for edge in parsed.edges
    }


def test_parse_newick_preserves_branch_lengths_on_edges() -> None:
    """Confirm Newick branch lengths are carried onto canonical endpoint links."""
    parsed = parse_newick("(A:0.10,(B:0.20,C:0.30)N:0.40)R:0.50;")

    edge_by_pair = {
        (edge.source, edge.target): edge.distance for edge in parsed.edges
    }
    assert edge_by_pair == {
        ("a", "r"): 0.10,
        ("b", "n"): 0.20,
        ("c", "n"): 0.30,
        ("n", "r"): 0.40,
    }
    assert parsed.explicit_node_ids == {"a", "b", "c", "n", "r"}


def test_parse_newick_ignores_empty_children_from_trailing_commas() -> None:
    """Confirm loose Newick separators do not create phantom missing-distance nodes."""
    parsed = parse_newick("((A:1,B:1,)X:2,(C:3,D:5,)Y:4,)Root;")

    edge_by_pair = {
        (edge.source, edge.target): edge.distance for edge in parsed.edges
    }
    assert edge_by_pair == {
        ("a", "x"): 1.0,
        ("b", "x"): 1.0,
        ("c", "y"): 3.0,
        ("d", "y"): 5.0,
        ("root", "x"): 2.0,
        ("root", "y"): 4.0,
    }
    assert all(edge.distance is not None for edge in parsed.edges)
    assert len(parsed.warnings) == 3


def test_parse_edgelist_accepts_optional_distance_column() -> None:
    """Confirm edge-list rows may carry an optional numeric distance."""
    parsed = parse_edgelist("source,target,distance\na,b,0.5\nb,c,1.25\n")

    assert parsed.nodes == ["a", "b", "c"]
    assert [(edge.source, edge.target, edge.distance) for edge in parsed.edges] == [
        ("a", "b", 0.5),
        ("b", "c", 1.25),
    ]
