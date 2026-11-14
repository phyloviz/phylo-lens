from phylo_lens_server.domain.summaries import aggregate_cluster_metadata


def test_aggregate_cluster_metadata_uses_mode_for_categorical_and_mean_for_numeric() -> (
    None
):
    member_metadata = [
        {"region": "north", "score": 10, "flag": True},
        {"region": "north", "score": 20, "flag": True},
        {"region": "south", "score": 30, "flag": False, "missing": None},
    ]
    schema = (("region", "string"), ("score", "number"), ("flag", "boolean"))

    aggregate = aggregate_cluster_metadata(member_metadata, schema)

    assert aggregate["region"] == "north"
    assert aggregate["score"] == 20.0
    assert aggregate["flag"] is True


def test_aggregate_cluster_metadata_skips_null_only_and_breaks_ties_alphabetically() -> (
    None
):
    member_metadata = [
        {"region": "zulu", "empty": None},
        {"region": "alpha", "empty": None},
    ]
    schema = (("region", "string"), ("empty", "string"))

    aggregate = aggregate_cluster_metadata(member_metadata, schema)

    assert aggregate["region"] == "alpha"
    assert "empty" not in aggregate
