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
