from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_NEWICK = "newick"
FORMAT_EDGELIST = "edgelist"

DATASET_DETERMINISTIC = "tree-deterministic"
DATASET_EDGELIST = "edge-list"

NEWICK_DETERMINISTIC_CONTENT = "((A,B)X,(C,D)Y)Root;"
EDGELIST_WITH_HEADER = "source,target\na,b\nb,c\n"

EXPECTED_NODE_COUNT_EDGELIST = 3
EXPECTED_EDGE_COUNT_EDGELIST = 2
EXPECTED_NODE_IDS_EDGELIST = ["a", "b", "c"]


def test_normalize_newick_is_deterministic() -> None:
    """Confirm normalization results are stable across repeated identical inputs."""
    request = NormalizeRequest(
        format=FORMAT_NEWICK,
        dataset_name=DATASET_DETERMINISTIC,
        content=NEWICK_DETERMINISTIC_CONTENT,
    )

    first = normalize_dataset(request)
    second = normalize_dataset(request)

    assert [n.id for n in first.dataset.nodes] == [n.id for n in second.dataset.nodes]
    assert [(e.id, e.source, e.target) for e in first.dataset.edges] == [
        (e.id, e.source, e.target) for e in second.dataset.edges
    ]


def test_normalize_edgelist_parses_header() -> None:
    """Confirm edge-list parser handles a source/target header row correctly."""
    request = NormalizeRequest(
        format=FORMAT_EDGELIST,
        dataset_name=DATASET_EDGELIST,
        content=EDGELIST_WITH_HEADER,
    )

    result = normalize_dataset(request)

    assert result.stats.node_count == EXPECTED_NODE_COUNT_EDGELIST
    assert result.stats.edge_count == EXPECTED_EDGE_COUNT_EDGELIST
    assert [node.id for node in result.dataset.nodes] == EXPECTED_NODE_IDS_EDGELIST
