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


def test_normalize_newick_preserves_edge_distances() -> None:
    """Confirm Newick branch lengths are emitted as canonical edge distances."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(A:0.10,(B:0.20,C:0.30)N:0.40)R:0.50;",
        )
    )

    assert [(edge.source, edge.target, edge.distance) for edge in result.dataset.edges] == [
        ("n", "b", 0.2),
        ("n", "c", 0.3),
        ("r", "a", 0.1),
        ("r", "n", 0.4),
    ]


def test_normalize_clamps_negative_newick_branch_lengths() -> None:
    """Confirm RapidNJ-style negative branch lengths stay prepare-compatible."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(A:-0.001,B:0.20)R:0;",
        )
    )

    assert [(edge.source, edge.target, edge.distance) for edge in result.dataset.edges] == [
        ("r", "a", 0.0),
        ("r", "b", 0.2),
    ]
    assert "clamped" in result.warnings[0]


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


def test_normalize_edgelist_preserves_optional_edge_distance() -> None:
    """Confirm weighted edge-list input is preserved on canonical edges."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_EDGELIST,
            content="source,target,distance\na,b,0.5\nb,c,1.25\n",
        )
    )

    assert [(edge.source, edge.target, edge.distance) for edge in result.dataset.edges] == [
        ("a", "b", 0.5),
        ("b", "c", 1.25),
    ]
