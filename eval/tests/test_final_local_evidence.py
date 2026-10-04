"""Guard target separation, diagnostic summaries, and browser-clock phases."""

import sqlite3

import pytest
from run_final_local_evidence import frames, phases, targets


def cluster_records(counts):
    connection = sqlite3.connect(":memory:")
    connection.execute(
        "create table prepared_clusters(cluster_id,lod_level,member_count,representative_node_id,x,y)"
    )
    connection.executemany(
        "insert into prepared_clusters values(?,?,?,?,?,?)",
        [
            (f"cluster-{i:03}", i % 3, count, str(i), 0, 0)
            for i, count in enumerate(counts)
        ],
    )
    return connection


def test_quantile_ties_yield_distinct_separated_counts():
    connection = cluster_records([2] * 50 + [3] * 40 + [4] * 7 + [30] * 2 + [300])
    evidence = targets(connection)
    chosen = evidence["targets"]
    assert [r["member_count"] for r in chosen] == [2, 4, 30]
    assert len({r["cluster_id"] for r in chosen}) == 3
    assert targets(connection) == evidence


def test_insufficient_separation_fails_before_measurement():
    with pytest.raises(ValueError):
        targets(cluster_records([2, 3, 4]))


def test_browser_clock_phases_sum_to_latency():
    result = {
        "input_event": {"timestamp": 100},
        "event": {"timestamp": 210},
        "t_settled": 230,
        "relevant_requests": [
            {"fetchInvocationTimestamp": 160, "responseTimestamp": 190}
        ],
    }
    measured = phases(result)
    assert measured["interaction_display_ms"] == 130
    assert (
        sum(
            measured[k]
            for k in (
                "input_to_request_ms",
                "http_interval_ms",
                "response_to_snapshot_ms",
                "snapshot_to_two_raf_ms",
            )
        )
        == 130
    )


def test_collapse_without_request_has_no_invented_http_phase():
    measured = phases(
        {"input_event": {"timestamp": 10}, "event": {"timestamp": 15}, "t_settled": 30}
    )
    assert measured == {
        "interaction_display_ms": 20,
        "input_to_snapshot_ms": 5,
        "snapshot_to_two_raf_ms": 15,
    }


def test_fifty_ms_threshold_is_strict_and_reports_denominator():
    assert frames([10, 50, 70]) == {
        "count": 3,
        "median_ms": 50,
        "p95_ms": 70,
        "max_ms": 70,
        "above_50ms_count": 1,
        "above_50ms_proportion": 1 / 3,
    }
