"""Selection must use logarithmic distance and stable level/ID tie-breaking."""

from rerun_medium_evidence import select_medium


def test_log_distance_can_choose_the_larger_absolute_difference():
    chosen = select_medium(
        [("sixty", 1, 60, "a", 0, 0), ("one-twenty", 2, 120, "b", 0, 0)], 2, 3796
    )
    assert chosen["member_count"] == 120


def test_equal_cardinality_ties_use_lowest_level_then_id():
    rows = [("b", 1, 88, "b", 0, 0), ("a", 2, 88, "a", 0, 0), ("a", 1, 88, "c", 0, 0)]
    chosen = select_medium(rows, 2, 3796)
    assert chosen["cluster_id"] == "a"
    assert chosen["lod_level"] == 1
    assert select_medium(list(reversed(rows)), 2, 3796) == chosen
