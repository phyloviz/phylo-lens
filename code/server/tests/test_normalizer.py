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


def test_normalize_newick_joins_tsv_ancillary_data_by_leaf_label() -> None:
    """Confirm user-supplied tabular metadata is compiled onto canonical node ids."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(P09:0.1,P12:0.2)Root;",
            ancillary_data={
                "format": "tsv",
                "join_column": "isolate",
                "content": (
                    "isolate\tcountry\tsource\tpenner\n"
                    "P09\tUnknown\tgoat\t9\n"
                    "P12\tCanada\thuman stool\t12\n"
                ),
            },
        )
    )

    assert result.dataset.metadata_by_node_id["p09"] == {
        "country": "Unknown",
        "source": "goat",
        "penner": 9,
    }
    assert result.dataset.metadata_by_node_id["p12"]["source"] == "human stool"
    assert {field.key: field.type for field in result.dataset.metadata_schema} == {
        "country": "string",
        "source": "string",
        "penner": "number",
    }
    assert result.warnings == []


def test_normalize_newick_warns_for_unmatched_ancillary_rows() -> None:
    """Confirm table rows that cannot join are reported without breaking ingest."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(P09:0.1,P12:0.2)Root;",
            ancillary_data={
                "join_column": "isolate",
                "content": "isolate,country\nP09,Unknown\nPX,Unknown\n",
            },
        )
    )

    assert list(result.dataset.metadata_by_node_id) == ["p09"]
    assert "did not match a node" in result.warnings[0]
    assert "did not include rows for 1 joinable nodes" in result.warnings[1]


def test_normalize_ancillary_data_allows_blank_cells_in_typed_columns() -> None:
    """Confirm sparse real-world metadata tables can keep null cells."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(3157:0.1,2475:0.2)Root;",
            ancillary_data={
                "format": "tsv",
                "join_column": "isolate",
                "content": (
                    "isolate\tregion\tyear\taliases\n"
                    "3157\t\t1991\t\n"
                    "2475\tManchester\t\tATCC\n"
                ),
            },
        )
    )

    assert result.dataset.metadata_by_node_id["3157"] == {
        "region": None,
        "year": 1991,
        "aliases": None,
    }
    assert result.dataset.metadata_by_node_id["2475"] == {
        "region": "Manchester",
        "year": None,
        "aliases": "ATCC",
    }
    assert {field.key: field.type for field in result.dataset.metadata_schema} == {
        "aliases": "string",
        "region": "string",
        "year": "number",
    }
