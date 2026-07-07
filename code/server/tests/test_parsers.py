import json
import re
from pathlib import Path

import pytest

from phylo_lens_server.data.parsers import (
    ParseError,
    parse_newick,
    parse_newick_forest,
)

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
        (frozenset((edge.source, edge.target)), edge.distance) for edge in parsed.edges
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
    content = f"{'(' * depth}A{')' * depth};"

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

    edge_by_pair = {(edge.source, edge.target): edge.distance for edge in parsed.edges}
    assert edge_by_pair == {
        ("r", "a"): 0.10,
        ("n", "b"): 0.20,
        ("n", "c"): 0.30,
        ("r", "n"): 0.40,
    }
    assert parsed.explicit_node_ids == {"a", "b", "c", "n", "r"}


def test_parse_newick_ignores_empty_children_from_trailing_commas() -> None:
    """Confirm loose Newick separators do not create phantom missing-distance nodes."""
    parsed = parse_newick("((A:1,B:1,)X:2,(C:3,D:5,)Y:4,)Root;")

    edge_by_pair = {(edge.source, edge.target): edge.distance for edge in parsed.edges}
    assert edge_by_pair == {
        ("x", "a"): 1.0,
        ("x", "b"): 1.0,
        ("y", "c"): 3.0,
        ("y", "d"): 5.0,
        ("root", "x"): 2.0,
        ("root", "y"): 4.0,
    }
    assert all(edge.distance is not None for edge in parsed.edges)
    # Trailing commas before ')' or ';' are a benign phylolib dialect quirk and
    # must not inflate the warning list (previously O(N) empty-child warnings).
    assert parsed.warnings == []


def test_parse_newick_warns_on_genuine_empty_child() -> None:
    """Confirm a genuine empty child position (double comma) still warns."""
    parsed = parse_newick("(A:1,,B:1)Root;")

    edge_by_pair = {(edge.source, edge.target): edge.distance for edge in parsed.edges}
    assert edge_by_pair == {
        ("root", "a"): 1.0,
        ("root", "b"): 1.0,
    }
    assert len(parsed.warnings) == 1


def test_parse_newick_does_not_flag_meaningless_underscore_labels_as_explicit() -> None:
    """Confirm '_' junction labels slugify to empty and are not join-eligible."""
    parsed = parse_newick("(4365:0.5,4601:0.5,)_:0.5;")

    assert parsed.explicit_node_ids == {"4365", "4601"}
    assert parsed.warnings == []


def test_parse_newick_forest_single_tree_passes_through() -> None:
    """A single-tree input flows through parse_newick_forest with no warning."""
    parsed = parse_newick_forest("(A,B)Root;")

    assert sorted(parsed.nodes) == ["a", "b", "root"]
    assert not any("disconnected components" in warning for warning in parsed.warnings)


def test_parse_newick_forest_merges_disconnected_components() -> None:
    """Multiple ``;``-terminated trees merge into one disconnected graph.

    This is the shape of precomputed goeBURST output: some parenthesized
    components plus bare singleton STs, each terminated by ``;``.
    """
    parsed = parse_newick_forest("(A:1.0)B;(C:1.0)D;99;")

    assert sorted(parsed.nodes) == ["99", "a", "b", "c", "d"]
    assert sorted((edge.source, edge.target) for edge in parsed.edges) == [
        ("b", "a"),
        ("d", "c"),
    ]
    # Singleton component contributes a node with no edge.
    assert "99" in parsed.nodes
    assert any("3 disconnected components" in warning for warning in parsed.warnings)


def test_parse_newick_forest_namespaces_generated_ids_across_components() -> None:
    """Unlabeled union ids restart per component; merge must avoid collisions."""
    parsed = parse_newick_forest("(A,B);(C,D);")

    assert len(parsed.nodes) == len(set(parsed.nodes))
    assert len(parsed.nodes) == 6


def test_parse_newick_forest_empty_content_raises() -> None:
    """Empty input defers to parse_newick so the same error is surfaced."""
    with pytest.raises(ParseError):
        parse_newick_forest("   ")
