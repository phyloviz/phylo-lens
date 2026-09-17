"""Synthetic reference exports keep the private research data out of regressions."""

import copy
import runpy
from pathlib import Path

import pytest

AUDIT = runpy.run_path(
    str(Path(__file__).resolve().parents[3] / "scripts/audit-typing-reference.py")
)
audit = AUDIT["audit"]
read_matrix = AUDIT["read_matrix"]

PROFILES = "ID\tL1\tL2\tL3\nA\t1\t1\t0\nB\t1\t1\t9\nC\t2\t1\t8\nD\t1\t2\t7\n"
# Reordered matrix tests identifier alignment instead of positional coincidence.
MATRIX = "4\nd\na\t1\nc\t2\t1\nb\t1\t0\t1\n"
TREE = "(b:0,c:1,d:1)a;"


def reference():
    nodes = [
        {"key": "A", "profile": ["1", "1", "0"]},
        {"key": "C", "profile": ["2", "1", "8"]},
        {"key": "D", "profile": ["1", "2", "7"]},
    ]
    return {
        "usedLoci": {"L1": 0, "L2": 1},
        "goeBURSTschemeGenesExport": [{"gene": "L1"}, {"gene": "L2"}],
        "goeburstprofilesize": 2,
        "indexesToRemove": {"2": True},
        "nodes": nodes,
        "subsetProfiles": [{"profile": node["profile"][:2]} for node in nodes],
        "mergedNodes": {
            "A": [{"key": "B", "profile": ["1", "1", "9"]}],
            "C": [],
            "D": [],
        },
        "sameNodeHas": {"A": "A", "B": "A", "C": "C", "D": "D"},
        "links": [
            {"source": "A", "target": "C", "value": 1},
            {"source": "A", "target": "D", "value": 1},
        ],
    }


def test_checks_entire_matrix_export_membership_and_mst_without_exposing_ids():
    report = audit(PROFILES, reference(), MATRIX, TREE)
    assert report["phylolib_pairs_checked"] == 6
    assert report["online_reconstructed_pairs_checked"] == 3
    assert report["online_original_profiles_checked"] == 4
    assert report["tree_total_distance"] == 2
    assert report["status"] == "pass"
    assert not any(key in report for key in ("ids", "profiles", "nodes", "links"))


@pytest.mark.parametrize(
    "matrix",
    [
        MATRIX.replace("2\t1", "3\t1"),
        MATRIX.replace("d\na", "a\na"),
        MATRIX.replace("d\na", "d\t0\na"),
        MATRIX.replace("2\t1", "nan\t1"),
    ],
)
def test_rejects_corrupt_or_incomplete_phylolib_matrix(matrix):
    with pytest.raises(ValueError):
        audit(PROFILES, reference(), matrix, TREE)


def test_rejects_online_edge_value_even_if_ui_maximum_looks_plausible():
    export = reference()
    export["links"][0]["value"] += 1
    with pytest.raises(ValueError, match="exported edge distance"):
        audit(PROFILES, export, MATRIX, TREE)


@pytest.mark.parametrize(
    "field", ["subsetProfiles", "mergedNodes", "sameNodeHas", "usedLoci"]
)
def test_rejects_changed_reference_data(field):
    export = copy.deepcopy(reference())
    match field:
        case "subsetProfiles":
            export[field][0]["profile"][0] = "9"
        case "mergedNodes":
            export[field]["A"] = []
        case "sameNodeHas":
            export[field]["B"] = "C"
        case "usedLoci":
            export[field]["L1"] = 2
    with pytest.raises(ValueError):
        audit(PROFILES, export, MATRIX, TREE)


def test_rejects_valid_distances_on_a_nonminimum_tree():
    export = reference()
    export["links"][1] = {"source": "C", "target": "D", "value": 2}
    with pytest.raises(ValueError, match="minimum spanning"):
        audit(PROFILES, export, MATRIX, TREE)


def test_accepts_alternative_equal_weight_edges():
    profiles = "ID\tL1\nA\t1\nB\t2\nC\t3\n"
    nodes = [{"key": key, "profile": [str(i + 1)]} for i, key in enumerate("ABC")]
    export = {
        "usedLoci": {"L1": 0},
        "goeBURSTschemeGenesExport": [{"gene": "L1"}],
        "goeburstprofilesize": 1,
        "indexesToRemove": {},
        "nodes": nodes,
        "subsetProfiles": [{"profile": node["profile"]} for node in nodes],
        "mergedNodes": {key: [] for key in "ABC"},
        "sameNodeHas": {key: key for key in "ABC"},
        "links": [
            {"source": "A", "target": "B", "value": 1},
            {"source": "B", "target": "C", "value": 1},
        ],
    }
    report = audit(profiles, export, "3\na\nb\t1\nc\t1\t1\n", "(b:1,c:1)a;")
    assert report["alternative_tree_edges_per_tree"] == 1
    assert report["tree_total_distance"] == 2
