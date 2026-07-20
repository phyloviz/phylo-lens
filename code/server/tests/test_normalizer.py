from pathlib import Path

import pytest

from phylo_lens_server.data import phylolib
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.data.parsers import ParseError

FORMAT_NEWICK = "newick"
FORMAT_TYPING_DATA = "typing_data"

DATASET_DETERMINISTIC = "tree-deterministic"

NEWICK_DETERMINISTIC_CONTENT = "((A,B)X,(C,D)Y)Root;"


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

    assert [
        (edge.source, edge.target, edge.distance) for edge in result.dataset.edges
    ] == [
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

    assert [
        (edge.source, edge.target, edge.distance) for edge in result.dataset.edges
    ] == [
        ("r", "a", 0.0),
        ("r", "b", 0.2),
    ]
    assert "clamped" in result.warnings[0]


def test_normalize_newick_joins_tsv_ancillary_data_by_leaf_label() -> None:
    """Confirm user-supplied tabular metadata is compiled onto canonical node ids."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(P09:0.1,P12:0.2);",
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

    assert {
        key: result.dataset.metadata_by_node_id["p09"][key]
        for key in ("country", "source", "penner", "profile_count")
    } == {
        "country": "Unknown",
        "source": "goat",
        "penner": 9,
        "profile_count": 1,
    }
    assert result.dataset.metadata_by_node_id["p12"]["source"] == "human stool"
    schema = {field.key: field.type for field in result.dataset.metadata_schema}
    assert {key: schema[key] for key in ("country", "source", "penner")} == {
        "country": "string",
        "source": "string",
        "penner": "number",
    }
    assert "profile_count" not in schema
    assert result.warnings == []


def test_normalize_newick_joins_ancillary_data_by_labeled_internal_node() -> None:
    """Confirm PHYLOViZ-style Newick joins include all explicit node labels."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(ST1:0.1,(ST2:0.2,ST3:0.3)ST4:0.4)ST5;",
            ancillary_data={
                "format": "tsv",
                "join_column": "ST",
                "content": (
                    "ST\tcountry\tcount\n"
                    "ST1\tPortugal\t2\n"
                    "ST4\tPortugal\t5\n"
                    "ST5\tSpain\t1\n"
                ),
            },
        )
    )

    assert result.dataset.metadata_by_node_id["st1"]["count"] == 2
    assert result.dataset.metadata_by_node_id["st4"]["country"] == "Portugal"
    assert result.dataset.metadata_by_node_id["st5"]["country"] == "Spain"
    assert (
        "Ancillary data did not include rows for 2 joinable nodes." in result.warnings
    )


def test_normalize_ancillary_data_aggregates_multiple_rows_per_node() -> None:
    """Confirm isolate rows sharing one ST produce profile counts and distributions."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(ST1:0.1,ST2:0.2);",
            ancillary_data={
                "format": "tsv",
                "join_column": "ST",
                "content": (
                    "ST\tcountry\tsource\n"
                    "ST1\tPortugal\tblood\n"
                    "ST1\tPortugal\tblood\n"
                    "ST1\tSpain\tcsf\n"
                    "ST2\tCanada\tblood\n"
                ),
            },
        )
    )

    st1_metadata = result.dataset.metadata_by_node_id["st1"]
    assert st1_metadata["profile_count"] == 3
    assert st1_metadata["country"] == "Portugal;Spain"
    assert st1_metadata["source"] == "blood;csf"
    assert st1_metadata["__category_count__country__value__Portugal"] == 2
    assert st1_metadata["__category_count__country__value__Spain"] == 1
    assert st1_metadata["__category_count__source__value__blood"] == 2
    assert st1_metadata["__category_count__source__value__csf"] == 1
    assert result.dataset.ancillary_rows_by_node_id["st1"] == [
        {"country": "Portugal", "source": "blood"},
        {"country": "Portugal", "source": "blood"},
        {"country": "Spain", "source": "csf"},
    ]
    assert result.warnings == []


def test_normalize_hides_derived_fields_from_public_schema() -> None:
    """Confirm generated metadata values do not leak into public schema fields."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(ST1:0.1,ST2:0.2);",
            metadata_schema=[{"key": "country", "type": "string"}],
            ancillary_data={
                "format": "tsv",
                "join_column": "ST",
                "content": ("ST\tcountry\nST1\tPortugal\nST1\tSpain\nST2\tCanada\n"),
            },
        )
    )

    schema = {field.key: field.type for field in result.dataset.metadata_schema}
    assert schema["country"] == "string"
    assert "profile_count" not in schema
    assert "__category_count__country__value__Portugal" not in schema
    assert result.dataset.metadata_by_node_id["st1"]["profile_count"] == 2


def test_normalize_can_expose_internal_schema_for_prepare_pipeline() -> None:
    """Confirm internal callers can still validate generated metadata keys."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(ST1:0.1,ST2:0.2);",
            metadata_schema=[{"key": "country", "type": "string"}],
            ancillary_data={
                "format": "tsv",
                "join_column": "ST",
                "content": "ST\tcountry\nST1\tPortugal\nST2\tCanada\n",
            },
        ),
        expose_internal_schema=True,
    )

    schema = {field.key: field.type for field in result.dataset.metadata_schema}
    assert schema["profile_count"] == "number"
    assert schema["__category_count__country__value__Portugal"] == "number"


def test_normalize_rejects_reserved_ancillary_column_names() -> None:
    """Confirm uploaded tables cannot overwrite generated implementation fields."""
    with pytest.raises(ParseError, match="profile_count"):
        normalize_dataset(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name=DATASET_DETERMINISTIC,
                content="(ST1:0.1,ST2:0.2);",
                ancillary_data={
                    "format": "tsv",
                    "join_column": "ST",
                    "content": "ST\tprofile_count\nST1\t999\n",
                },
            )
        )


def test_normalize_rejects_reserved_category_count_columns() -> None:
    """Confirm encoded category-count backing fields are not user-addressable."""
    with pytest.raises(ParseError, match="__category_count__country__value__PT"):
        normalize_dataset(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name=DATASET_DETERMINISTIC,
                content="(ST1:0.1,ST2:0.2);",
                ancillary_data={
                    "format": "tsv",
                    "join_column": "ST",
                    "content": "ST\t__category_count__country__value__PT\nST1\t999\n",
                },
            )
        )


def test_normalize_rejects_reserved_direct_metadata_keys() -> None:
    """Confirm JSON metadata cannot address generated implementation fields."""
    with pytest.raises(ParseError, match="profile_count"):
        normalize_dataset(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name=DATASET_DETERMINISTIC,
                content="(ST1:0.1,ST2:0.2);",
                metadata_schema=[{"key": "profile_count", "type": "number"}],
                metadata_by_node_id={"st1": {"profile_count": 999}},
            )
        )


def test_normalize_ancillary_data_respects_declared_string_field_types() -> None:
    """Confirm numeric-looking ancillary fields stay strings when declared as strings."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(3157:0.1,2475:0.2);",
            metadata_schema=[
                {"key": "year", "type": "string"},
                {"key": "sender", "type": "string"},
                {"key": "id", "type": "string"},
                {"key": "curator", "type": "string"},
            ],
            ancillary_data={
                "format": "tsv",
                "join_column": "id",
                "content": (
                    "id\tyear\tsender\tcurator\n3157\t1991\t42\t7\n2475\t2004\t42\t8\n"
                ),
            },
        )
    )

    node_metadata = result.dataset.metadata_by_node_id["3157"]
    assert node_metadata["year"] == "1991"
    assert node_metadata["sender"] == "42"
    assert node_metadata["curator"] == "7"
    assert node_metadata["profile_count"] == 1
    schema = {field.key: field.type for field in result.dataset.metadata_schema}
    assert schema["year"] == "string"
    assert schema["sender"] == "string"
    assert schema["id"] == "string"
    assert schema["curator"] == "string"


def test_normalize_direct_metadata_respects_declared_string_field_types() -> None:
    """Confirm direct metadata payloads honor declared string scalar fields."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(3157:0.1,2475:0.2);",
            metadata_schema=[
                {"key": "year", "type": "string"},
                {"key": "sender", "type": "string"},
                {"key": "id", "type": "string"},
                {"key": "curator", "type": "string"},
            ],
            metadata_by_node_id={
                "3157": {"year": 1991, "sender": 42, "id": 3157, "curator": 7},
                "2475": {"year": 2004, "sender": 43, "id": 2475, "curator": 8},
            },
        )
    )

    node_metadata = result.dataset.metadata_by_node_id["3157"]
    assert node_metadata == {
        "year": "1991",
        "sender": "42",
        "id": "3157",
        "curator": "7",
    }


def test_normalize_final_metadata_respects_merged_schema_types() -> None:
    """Confirm final schema coercion catches values from every metadata source."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="(3157:0.1,2475:0.2);",
            metadata_schema=[
                {"key": "year", "type": "string"},
                {"key": "sender", "type": "string"},
                {"key": "curator", "type": "string"},
            ],
            metadata_by_node_id={
                "3157": {"year": 1991, "sender": 42, "curator": 7},
            },
            ancillary_data={
                "format": "tsv",
                "join_column": "id",
                "content": ("id\tyear\tsender\tcurator\n2475\t2004\t43\t8\n"),
            },
        )
    )

    assert result.dataset.metadata_by_node_id["3157"]["year"] == "1991"
    assert result.dataset.metadata_by_node_id["3157"]["sender"] == "42"
    assert result.dataset.metadata_by_node_id["2475"]["year"] == "2004"
    assert result.dataset.metadata_by_node_id["2475"]["sender"] == "43"


def test_normalize_newick_does_not_join_generated_union_node_ids() -> None:
    """Confirm generated union-node ids are not treated as user identifiers."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content="((A:0.1,B:0.2):0.3,C:0.4)Root;",
            ancillary_data={
                "format": "tsv",
                "join_column": "id",
                "content": ("id\tcountry\nA\tPortugal\nunion_2\tSpain\nRoot\tFrance\n"),
            },
        )
    )

    assert set(result.dataset.metadata_by_node_id) == {"a", "root"}
    assert "Ancillary row 3 with id='union_2' did not match a node." in result.warnings
    assert (
        "Ancillary data did not include rows for 2 joinable nodes." in result.warnings
    )


def test_normalize_single_unlabeled_newick_does_not_join_generated_id() -> None:
    """Confirm no-edge Newick joins still require explicit source labels."""
    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_DETERMINISTIC,
            content=";",
            ancillary_data={
                "format": "tsv",
                "join_column": "id",
                "content": "id\tcountry\nunion_1\tPortugal\n",
            },
        )
    )

    assert result.dataset.metadata_by_node_id == {}
    assert "did not match a node" in result.warnings[0]


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
    assert "did not include rows for 2 joinable nodes" in result.warnings[1]


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

    assert {
        key: result.dataset.metadata_by_node_id["3157"][key]
        for key in ("region", "year", "aliases", "profile_count")
    } == {
        "region": None,
        "year": 1991,
        "aliases": None,
        "profile_count": 1,
    }
    assert {
        key: result.dataset.metadata_by_node_id["2475"][key]
        for key in ("region", "year", "aliases", "profile_count")
    } == {
        "region": "Manchester",
        "year": None,
        "aliases": "ATCC",
        "profile_count": 1,
    }
    schema = {field.key: field.type for field in result.dataset.metadata_schema}
    assert {key: schema[key] for key in ("aliases", "region", "year")} == {
        "aliases": "string",
        "region": "string",
        "year": "number",
    }
    assert "profile_count" not in schema


TYPING_PROFILES = "ST\tadk\tfumC\nA\t1\t2\nB\t1\t3\nC\t4\t5\n"
TYPING_NEWICK = "((A:1,B:1):1,C:2);"


def test_typing_data_maps_phylolib_graph_into_pipeline(monkeypatch) -> None:
    """A typing_data request converts profiles to a graph then normalizes as usual."""
    from phylo_lens_server.data.parsers import parse_newick

    calls: list[str] = []

    def fake_convert(profiles: str, **kwargs):
        calls.append(profiles)
        return parse_newick(TYPING_NEWICK)

    monkeypatch.setattr(
        "phylo_lens_server.data.normalizer.typing_profiles_to_graph", fake_convert
    )

    result = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_TYPING_DATA,
            dataset_name="typing-dataset",
            content=TYPING_PROFILES,
        )
    )

    assert calls == [TYPING_PROFILES]
    assert result.dataset.source.format == "typing_data"
    assert len(result.dataset.nodes) == len(
        normalize_dataset(
            NormalizeRequest(
                format=FORMAT_NEWICK,
                dataset_name="ref",
                content=TYPING_NEWICK,
            )
        ).dataset.nodes
    )


def test_typing_data_runtime_missing_raises_parse_error(monkeypatch) -> None:
    """When PhyloLib is unavailable, typing ingest fails as a client-facing error."""
    monkeypatch.delenv(phylolib.ENV_PHYLOLIB_JAR, raising=False)

    with pytest.raises(ParseError) as excinfo:
        normalize_dataset(
            NormalizeRequest(
                format=FORMAT_TYPING_DATA,
                dataset_name="typing-dataset",
                content=TYPING_PROFILES,
            )
        )

    assert "PhyloLib" in str(excinfo.value)


def test_typing_profiles_to_newick_prefers_local_phylolib_jar(
    monkeypatch, tmp_path
) -> None:
    """Production runs the configured PhyloLib JAR directly."""
    jar_path = tmp_path / "phylolib.jar"
    jar_path.write_text("fake jar", encoding="utf-8")
    monkeypatch.setenv(phylolib.ENV_PHYLOLIB_JAR, str(jar_path))
    monkeypatch.setenv(phylolib.ENV_PHYLOLIB_JAVA, "/opt/java/openjdk/bin/java")

    commands: list[list[str]] = []

    def fake_run(command, **kwargs):
        commands.append(command)
        if "algorithm" in command:
            out_arg = next(arg for arg in command if arg.startswith("--out=newick:"))
            tree_path = Path(out_arg.removeprefix("--out=newick:"))
            tree_path.write_text(TYPING_NEWICK, encoding="utf-8")

        class _Completed:
            stdout = ""
            stderr = ""

        return _Completed()

    monkeypatch.setattr(phylolib.subprocess, "run", fake_run)

    newick = phylolib.typing_profiles_to_newick(TYPING_PROFILES)

    assert newick == TYPING_NEWICK
    assert commands
    expected_prefix = ["/opt/java/openjdk/bin/java", "-jar", str(jar_path)]
    assert all(command[:3] == expected_prefix for command in commands)
    assert len(commands) == 2
    assert commands[0][3:5] == ["distance", phylolib.DEFAULT_DISTANCE_METHOD]
    assert commands[0][5].startswith("--dataset=ml:")
    assert commands[0][6].startswith("--out=symmetric:")
    assert commands[1][3:5] == ["algorithm", "goeburst"]
    assert commands[1][5].startswith("--matrix=symmetric:")
    assert commands[1][6].startswith("--out=newick:")
    assert commands[1][7] == f"--lvs={phylolib.DEFAULT_GOEBURST_LVS}"


def test_typing_profiles_to_newick_reads_jar_output(monkeypatch, tmp_path) -> None:
    """The two-stage PhyloLib path returns the Newick the JAR wrote."""
    jar_path = tmp_path / "phylolib.jar"
    jar_path.write_text("fake jar", encoding="utf-8")
    monkeypatch.setenv(phylolib.ENV_PHYLOLIB_JAR, str(jar_path))
    temp_dirs: list[Path] = []

    def fake_run(command, **kwargs):
        # The algorithm stage is responsible for producing the tree file. We
        # locate the output path from the newick reference and write the tree.
        if "algorithm" in command:
            out_arg = next(arg for arg in command if arg.startswith("--out=newick:"))
            tree_path = Path(out_arg.removeprefix("--out=newick:"))
            temp_dirs.append(tree_path.parent)
            tree_path.write_text(TYPING_NEWICK, encoding="utf-8")

        class _Completed:
            stdout = ""
            stderr = ""

        return _Completed()

    monkeypatch.setattr(phylolib.subprocess, "run", fake_run)

    newick = phylolib.typing_profiles_to_newick(TYPING_PROFILES)

    assert newick == TYPING_NEWICK
    assert temp_dirs
    assert all(not temp_dir.exists() for temp_dir in temp_dirs)


def test_typing_profiles_to_newick_stage_failure_raises(monkeypatch, tmp_path) -> None:
    """A non-zero PhyloLib process exit surfaces a typed TypingNormalizeError."""
    jar_path = tmp_path / "phylolib.jar"
    jar_path.write_text("fake jar", encoding="utf-8")
    monkeypatch.setenv(phylolib.ENV_PHYLOLIB_JAR, str(jar_path))

    def fake_run(command, **kwargs):
        raise phylolib.subprocess.CalledProcessError(
            returncode=1, cmd=command, stderr="boom"
        )

    monkeypatch.setattr(phylolib.subprocess, "run", fake_run)

    with pytest.raises(phylolib.TypingNormalizeError) as excinfo:
        phylolib.typing_profiles_to_newick(TYPING_PROFILES)

    assert excinfo.value.reason == phylolib.TYPING_PHYLOLIB_DISTANCE_FAILED


TYPING_FOREST_NEWICK = "(B:1.0)A;(D:1.0)C;"


def test_typing_profiles_to_graph_merges_forest(monkeypatch) -> None:
    """A goeBURST forest is kept as one disconnected graph, no ST dropped."""
    monkeypatch.setattr(
        phylolib, "typing_profiles_to_newick", lambda profiles, **kwargs: TYPING_FOREST_NEWICK
    )

    graph = phylolib.typing_profiles_to_graph(TYPING_PROFILES)

    assert sorted(graph.nodes) == ["a", "b", "c", "d"]
    assert sorted((edge.source, edge.target) for edge in graph.edges) == [
        ("a", "b"),
        ("c", "d"),
    ]
    assert any("disconnected components" in warning for warning in graph.warnings)


def test_typing_profiles_to_graph_single_tree_has_no_forest_warning(monkeypatch) -> None:
    """A single connected component passes through without a forest warning."""
    monkeypatch.setattr(
        phylolib, "typing_profiles_to_newick", lambda profiles, **kwargs: TYPING_NEWICK
    )

    graph = phylolib.typing_profiles_to_graph(TYPING_PROFILES)

    assert not any("disconnected components" in warning for warning in graph.warnings)
