"""Domain snapshots stay immutable through copying and JSON round trips."""

from dataclasses import FrozenInstanceError

import pytest
from pydantic import ValidationError

from phylo_lens_server.data.parsers import parse_newick_forest
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.layout import _place_isolated_nodes


def dataset():
    return ingest_dataset(
        NormalizeRequest(
            format="typing_data",
            content="id\tL1\na\t1\nb\t1\n",
            ancillary_data={"content": "id,country\na,PT\nb,ES\n", "join_column": "id"},
        ).to_domain()
    ).dataset


def test_dataset_is_deeply_immutable():
    value = dataset()
    with pytest.raises(ValidationError):
        value.dataset_id = "changed"
    with pytest.raises(TypeError):
        value.isolates_by_node_id["a"] = ()
    with pytest.raises(ValidationError):
        value.isolates_by_node_id["a"][0].id = "changed"
    with pytest.raises(TypeError):
        value.isolates_by_node_id["a"][0].ancillary_data["country"] = "changed"
    with pytest.raises(TypeError):
        value.annotations_by_node_id["a"].ancillary_summary.category_counts["country"][
            "PT"
        ] = 20
    assert isinstance(value.nodes, tuple) and isinstance(value.edges, tuple)


def test_copy_and_serialization_keep_nested_values_immutable():
    value = dataset()
    for copy in (
        value.model_copy(deep=True),
        Dataset.model_validate_json(value.model_dump_json()),
        value.model_copy(
            update={
                "isolates_by_node_id": dict(value.isolates_by_node_id),
                "nodes": list(value.nodes),
            }
        ),
    ):
        assert copy == value
        assert isinstance(copy.nodes, tuple)
        with pytest.raises(TypeError):
            copy.isolates_by_node_id["a"] = ()


def test_prepare_input_owns_its_observation_snapshot():
    values = {"a": {"country": "PT"}}
    request = NormalizeRequest(
        format="newick", content="a;", ancillary_by_node_id=values
    ).to_domain()
    values["a"]["country"] = "changed"
    assert request.ancillary_by_node_id["a"]["country"] == "PT"
    with pytest.raises(TypeError):
        request.ancillary_by_node_id["a"]["country"] = "changed"


def test_parser_publishes_an_immutable_forest_with_ordered_warnings():
    graph = parse_newick_forest("a;b;")
    assert isinstance(graph.nodes, tuple) and isinstance(graph.edges, tuple)
    assert isinstance(graph.explicit_node_ids, frozenset)
    assert graph.warnings[-1].startswith("Newick input contains 2")
    with pytest.raises(FrozenInstanceError):
        graph.nodes = ()


def test_isolated_node_placement_does_not_modify_input_geometry():
    original = {"a": (1.0, 2.0)}
    positioned = _place_isolated_nodes(original, ("isolated",))
    assert original == {"a": (1.0, 2.0)}
    assert positioned["a"] == original["a"]
    assert "isolated" in positioned
