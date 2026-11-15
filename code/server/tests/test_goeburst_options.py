import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from phylo_lens_server.data import phylolib
from phylo_lens_server.data.parsers import ParsedEdge, ParsedGraph, ParseError
from phylo_lens_server.data.typing_profiles import validate_goeburst_tree
from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.typing import GoeBurstOptions
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset

PROFILES = (
    "ST\tL1\tL2\tL3\tL4\n"
    "A\t1\t1\t1\t1\n"
    "A2\t1\t1\t1\t1\n"
    "B\t1\t1\t1\t2\n"
    "C\t2\t2\t2\t2\n"
    "D\t3\t3\t3\t3\n"
)


def request(nlv=3):
    return NormalizeRequest(
        format="typing_data",
        content=PROFILES,
        typing_options={"algorithm": "goeburst", "nlv": nlv},
        ancillary_data={
            "content": "ID\tcountry\nA\tPT\nA2\tES\nB\tFR\nC\tDE\nD\tIT\n",
            "join_column": "ID",
            "format": "tsv",
        },
    )


@pytest.mark.parametrize("nlv", [0, -1, 1.5, "3", True, 2_147_483_648])
def test_rejects_invalid_nlv_at_request_boundary(nlv):
    with pytest.raises(ValidationError):
        request(nlv)


def test_typing_options_defaults_and_exclusive_modes():
    normal = NormalizeRequest(
        format="typing_data",
        content=PROFILES,
        typing_options={"algorithm": "goeburst"},
    )
    assert normal.to_domain().typing_options == GoeBurstOptions(nlv=3)
    assert (
        NormalizeRequest(format="typing_data", content=PROFILES).typing_options is None
    )
    for options in (
        {"algorithm": "unknown"},
        {"algorithm": "goeburstfullmst", "nlv": 3},
        {"algorithm": "goeburst", "level": 3},
    ):
        with pytest.raises(ValidationError):
            NormalizeRequest(
                format="typing_data", content=PROFILES, typing_options=options
            )
    with pytest.raises(ValidationError, match="typing_data"):
        NormalizeRequest(
            format="newick", content="A;", typing_options={"algorithm": "goeburst"}
        )


@pytest.mark.parametrize(
    ("nlv", "newick", "edge_count", "roots"),
    [
        (1, "(b:1)a;c;d;", 1, ("a", "c", "d")),
        (3, "((c:3)b:1)a;d;", 2, ("b", "d")),
        (4, "((c:3,d:4)b:1)a;", 3, ("b",)),
        (100, "((c:3,d:4)b:1)a;", 3, ("b",)),
    ],
)
def test_standard_goeburst_preserves_bounded_forest_and_isolates(
    monkeypatch,
    nlv,
    newick,
    edge_count,
    roots,
):
    calls = []

    def cli_spy(args, **kwargs):
        calls.append(args)
        if args[0] == "distance":
            profile_path = Path(
                next(
                    arg.removeprefix("--dataset=ml:")
                    for arg in args
                    if arg.startswith("--dataset=")
                )
            )
            assert profile_path.read_text() == (
                "ST\tL1\tL2\tL3\tL4\n"
                "a\t1\t1\t1\t1\nb\t1\t1\t1\t2\n"
                "c\t2\t2\t2\t2\nd\t3\t3\t3\t3\n"
            )
            output = Path(
                next(
                    arg.removeprefix("--out=symmetric:")
                    for arg in args
                    if arg.startswith("--out=")
                )
            )
            output.write_text("4\na\nb\t1\nc\t4\t3\nd\t4\t4\t4\n")
        else:
            output = Path(
                next(
                    arg.removeprefix("--out=newick:")
                    for arg in args
                    if arg.startswith("--out=")
                )
            )
            output.write_text(newick)

    monkeypatch.setattr(phylolib, "_run_phylolib_cli", cli_spy)
    result = ingest_dataset(request(nlv).to_domain())
    dataset = result.dataset
    assert result.warnings == ()
    assert calls[1][0:2] == ["algorithm", "goeburst"]
    assert f"--lvs={min(nlv, 4)}" in calls[1]
    assert {node.id for node in dataset.nodes} == {"a", "b", "c", "d"}
    assert len(dataset.edges) == edge_count
    assert all(0 < edge.distance <= nlv for edge in dataset.edges)
    assert dataset.technical_roots == roots
    assert {
        isolate.id
        for members in dataset.isolates_by_node_id.values()
        for isolate in members
    } == {"A", "A2", "B", "C", "D"}
    assert [isolate.id for isolate in dataset.isolates_by_node_id["a"]] == ["A", "A2"]
    assert [
        isolate.ancillary_data["country"]
        for isolate in dataset.isolates_by_node_id["a"]
    ] == ["PT", "ES"]
    assert dataset.source.typing_options == GoeBurstOptions(nlv=nlv)
    restored = type(dataset).model_validate_json(dataset.model_dump_json())
    assert restored == dataset


def test_bounded_goeburst_still_rejects_cycles_and_over_level_edges():
    membership = {"a": (), "b": (), "c": ()}
    graph = ParsedGraph(
        ["a", "b", "c"],
        [ParsedEdge("a", "b", 1), ParsedEdge("b", "c", 1), ParsedEdge("a", "c", 1)],
        component_roots=("a",),
    )
    with pytest.raises(ParseError, match="acyclic"):
        validate_goeburst_tree(graph, membership, max_level=1)
    with pytest.raises(ParseError, match="nLV"):
        validate_goeburst_tree(
            ParsedGraph(
                ["a", "b", "c"], [ParsedEdge("a", "b", 2)], component_roots=("a", "c")
            ),
            membership,
            max_level=1,
        )


@pytest.mark.parametrize("distance", [float("inf"), float("-inf"), float("nan")])
def test_full_mst_rejects_nonfinite_inference_edges(distance):
    with pytest.raises(ParseError, match="non-finite"):
        validate_goeburst_tree(
            ParsedGraph(
                ["a", "b"], [ParsedEdge("a", "b", distance)], component_roots=("a",)
            ),
            {"a": (), "b": ()},
        )


@pytest.mark.skipif(
    not os.environ.get(phylolib.ENV_PHYLOLIB_JAR),
    reason="Requires the pinned PhyloLib JAR",
)
def test_real_phylolib_modes_match_independent_hamming_and_component_oracle():
    datasets = [
        ingest_dataset(request(level).to_domain()).dataset for level in (1, 3, 4)
    ]
    full_request = NormalizeRequest.model_validate(
        {
            **request(4).model_dump(),
            "typing_options": {"algorithm": "goeburstfullmst"},
        }
    )
    full = ingest_dataset(full_request.to_domain()).dataset
    # Hand-calculated Hamming distances: AB=1, AC=4, AD=4, BC=3, BD=4, CD=4.
    distances = {
        frozenset(pair): distance
        for pair, distance in [
            ("ab", 1),
            ("ac", 4),
            ("ad", 4),
            ("bc", 3),
            ("bd", 4),
            ("cd", 4),
        ]
    }
    for dataset, count, components in zip(
        [*datasets, full], [1, 2, 3, 3], [3, 2, 1, 1], strict=True
    ):
        assert len(dataset.edges) == count
        assert len(dataset.technical_roots) == components
        assert (
            sum(len(members) for members in dataset.isolates_by_node_id.values()) == 5
        )
        for edge in dataset.edges:
            assert edge.distance == distances[frozenset((edge.source, edge.target))]
    assert full.edges == datasets[-1].edges
    assert full.technical_roots == datasets[-1].technical_roots
    assert (
        len({layout_version_for_dataset(dataset) for dataset in [*datasets, full]}) == 4
    )
