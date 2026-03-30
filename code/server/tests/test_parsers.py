import json
import re
from pathlib import Path

import pytest

from phylo_lens_server.data.parsers import ParseError, parse_newick

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
    assert all(
        source in set(parsed.nodes) and target in set(parsed.nodes)
        for source, target in parsed.edges
    )


def test_parse_newick_generates_deterministic_ids_for_unlabeled_internal_nodes() -> None:
    """Confirm streaming parsing preserves preorder internal-id generation."""
    parsed = parse_newick("((A,B),(C,D));")

    assert set(parsed.nodes) == {
        "internal_1",
        "internal_2",
        "internal_3",
        "a",
        "b",
        "c",
        "d",
    }
    assert set(parsed.edges) == {
        ("internal_1", "internal_2"),
        ("internal_1", "internal_3"),
        ("internal_2", "a"),
        ("internal_2", "b"),
        ("internal_3", "c"),
        ("internal_3", "d"),
    }


def test_parse_newick_handles_deep_trees_without_recursion() -> None:
    """Confirm deeply nested trees parse without relying on the Python call stack."""
    depth = 5000
    content = f'{"(" * depth}A{")" * depth};'

    parsed = parse_newick(content)

    assert len(parsed.nodes) == depth + 1
    assert len(parsed.edges) == depth
    assert "a" in parsed.nodes
    assert "internal_1" in parsed.nodes
    assert ("internal_1", "internal_2") in set(parsed.edges)
