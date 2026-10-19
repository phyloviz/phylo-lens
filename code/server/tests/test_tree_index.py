import pytest
from pydantic import ValidationError

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import prepare_layout_artifacts
from phylo_lens_server.pipeline.tree_index import index_forest


def test_index_handles_deep_chains_without_recursion_and_visits_each_link_once():
    class Links(list):
        reads = 0

        def __reversed__(self):
            for link in super().__reversed__():
                Links.reads += 1
                yield link

    size = 20000
    neighbors = {str(i): Links() for i in range(size)}
    for i in range(1, size):
        neighbors[str(i - 1)].append((str(i), str(i)))
        neighbors[str(i)].append((str(i - 1), str(i)))
    entries = index_forest(neighbors, ("0",))
    assert Links.reads == 2 * (size - 1)
    assert entries[0].size == size
    assert entries[-1].depth == size - 1
    assert entries[-1].size == 1


def test_forest_intervals_are_contiguous_and_keep_components_disjoint():
    neighbors = {
        "r": [("b", "1"), ("a", "2")],
        "a": [("r", "2")],
        "b": [("r", "1"), ("c", "3")],
        "c": [("b", "3")],
        "s": [],
    }
    entries = index_forest(neighbors, ("r", "s"))
    assert [(e.node_id, e.start, e.end, e.parent_id) for e in entries] == [
        ("r", 0, 4, None),
        ("b", 1, 3, "r"),
        ("c", 2, 3, "b"),
        ("a", 3, 4, "r"),
        ("s", 4, 5, None),
    ]
    assert entries[-1].component_id == "s"


@pytest.mark.parametrize("roots", [("r", "r"), (), ("missing",), ("r", "a")])
def test_index_rejects_invalid_rooting(roots):
    with pytest.raises(ValueError):
        index_forest({"r": [("a", "e")], "a": [("r", "e")]}, roots)


def test_index_rejects_cycles():
    with pytest.raises(ValueError, match="acyclic"):
        index_forest(
            {
                "a": [("b", "1"), ("c", "3")],
                "b": [("a", "1"), ("c", "2")],
                "c": [("a", "3"), ("b", "2")],
            },
            ("a",),
        )


@pytest.mark.parametrize("value", [-1, 1.5, True, "64"])
def test_policy_rejects_invalid_threshold(value):
    with pytest.raises(ValidationError):
        LodOptions(small_component_threshold=value)


def test_policy_default_and_disabled_protection_have_distinct_identity_and_same_topology():
    dataset = ingest_dataset(
        NormalizeRequest(format="newick", content="((((a)b)c)d)root;").to_domain()
    ).dataset
    default = prepare_layout_artifacts(dataset)
    explicit = prepare_layout_artifacts(
        dataset, lod_options=LodOptions(small_component_threshold=64)
    )
    disabled = prepare_layout_artifacts(
        dataset, lod_options=LodOptions(small_component_threshold=0)
    )
    assert default.layout_version == explicit.layout_version != disabled.layout_version
    assert all(c.member_count == 1 for c in default.clusters)
    assert any(c.member_count > 1 for c in disabled.clusters)
    assert default.tree_index == disabled.tree_index
