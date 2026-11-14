import shutil
import subprocess

import pytest
from pydantic import ValidationError

from phylo_lens_server.domain.models import GraphEdge
from phylo_lens_server.domain.sfdp import (
    SfdpOptions,
    SfdpOverlap,
    SfdpQuadtree,
    SfdpSmoothing,
)
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.layout import (
    GRAPHVIZ_SFDP_COMMAND,
    GraphvizLayoutError,
    cluster_geometry,
    compute_prepared_layouts,
    graphviz_dot_payload,
    graphviz_sfdp_positions,
    parse_graphviz_plain_positions,
)
from phylo_lens_server.pipeline.lod import (
    prepare_layout_artifacts,
)
from tests.support.preparation import FORMAT_NEWICK
from tests.support.preparation import branching_dataset as _branching_dataset
from tests.support.preparation import varied_chain_dataset as _varied_chain_dataset
from tests.support.preparation import weighted_tree as _dataset

SFDP_AVAILABLE = shutil.which(GRAPHVIZ_SFDP_COMMAND) is not None


def test_default_sfdp_options_emit_phylolens_defaults_in_dot() -> None:
    node_ids = ("a", "b")
    edges = (GraphEdge(id="e1", source="a", target="b", distance=1.0),)

    default_payload = graphviz_dot_payload(node_ids, edges)

    assert default_payload == graphviz_dot_payload(node_ids, edges, SfdpOptions())
    assert (
        'graph [K=0.3, repulsiveforce=1, overlap="prism0", '
        'overlap_scaling=-4, smoothing="spring", quadtree="normal", '
        "beautify=false, pack=true,"
    ) in default_payload
    assert "splines=false];" in default_payload


def test_sfdp_options_reach_generated_dot() -> None:
    payload = graphviz_dot_payload(
        ("a", "b"),
        (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
        SfdpOptions(
            k=0.75,
            repulsiveForce=2.0,
            overlap=SfdpOverlap.PRISM,
            overlapScaling=-4.5,
            smoothing=SfdpSmoothing.SPRING,
            quadtree=SfdpQuadtree.FAST,
            beautify=True,
        ),
    )

    assert "K=0.75" in payload
    assert "repulsiveforce=2" in payload
    assert 'overlap="prism0"' in payload
    assert "overlap_scaling=-4.5" in payload
    assert 'smoothing="spring"' in payload
    assert 'quadtree="fast"' in payload
    assert "beautify=true" in payload


@pytest.mark.parametrize(
    ("prism_iterations", "expected_overlap"),
    ((10, 'overlap="prism10"'), (100, 'overlap="prism100"')),
)
def test_prism_iterations_are_serialized_into_overlap(
    prism_iterations: int,
    expected_overlap: str,
) -> None:
    payload = graphviz_dot_payload(
        ("a", "b"),
        (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
        SfdpOptions(prismIterations=prism_iterations),
    )

    assert expected_overlap in payload


def test_scale_overlap_uses_defaults_without_prism_attributes() -> None:
    payload = graphviz_dot_payload(
        ("a", "b"),
        (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
        SfdpOptions(overlap=SfdpOverlap.SCALE),
    )

    assert 'overlap="scale"' in payload
    assert "overlap_scaling=" not in payload


@pytest.mark.parametrize(
    "options",
    (
        {"overlap": SfdpOverlap.SCALE, "prism_iterations": 10},
        {"overlap": SfdpOverlap.SCALE, "overlap_scaling": -2.0},
    ),
)
def test_scale_overlap_rejects_explicit_prism_configuration(
    options: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        SfdpOptions(**options)


@pytest.mark.parametrize(
    "options",
    (
        {"overlap": "unsupported"},
        {"smoothing": "blur"},
        {"quadtree": "accurate"},
        {"k": 0},
        {"k": True},
        {"k": "0.5"},
        {"repulsiveForce": -0.1},
        {"unexpected": True},
    ),
)
def test_sfdp_options_reject_invalid_public_values(options: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        NormalizeRequest(
            format=FORMAT_NEWICK,
            content="(a:1,b:1)root;",
            sfdp_options=options,
        )


def test_cluster_geometry_computes_bounds_and_radius_in_one_pass() -> None:
    bounds, radius = cluster_geometry(
        {"a": (1.0, 2.0), "b": (4.0, -2.0)},
        (1.0, 2.0),
    )

    assert bounds.min_x == 1.0
    assert bounds.max_x == 4.0
    assert bounds.min_y == -2.0
    assert bounds.max_y == 2.0
    assert radius == 5.0


@pytest.mark.skipif(
    not SFDP_AVAILABLE,
    reason=("Force-directed spread requires the Graphviz 'sfdp' binary."),
)
def test_open_force_tree_layout_spreads_branching_tree_on_both_axes() -> None:
    dataset = _branching_dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, _node_positions = compute_prepared_layouts(artifacts)
    xs = [layout.x for layout in cluster_layouts]
    ys = [layout.y for layout in cluster_layouts]
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)

    assert len(cluster_layouts) > 20
    assert x_span > 0
    assert y_span > 0
    assert min(x_span, y_span) > max(x_span, y_span) * 0.2


def test_layout_fails_when_sfdp_is_missing_without_circular_fallback(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: None,
    )

    artifacts = prepare_layout_artifacts(_dataset())
    with pytest.raises(GraphvizLayoutError) as error:
        compute_prepared_layouts(artifacts)

    assert error.value.diagnostics.algorithm == "sfdp"
    assert (
        error.value.diagnostics.detail == "The sfdp executable was not found on PATH."
    )


def test_tree_layout_covers_every_node_of_a_large_chain() -> None:
    dataset = _varied_chain_dataset(1_000)
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions = compute_prepared_layouts(artifacts)

    from math import isfinite

    expected = {node.id for node in dataset.nodes}
    assert len(node_positions) == len(expected) == 1_000
    assert {position.node_id for position in node_positions} == expected
    assert all(
        isfinite(position.x) and isfinite(position.y) for position in node_positions
    )
    assert {cluster.cluster_id for cluster in cluster_layouts} == {
        cluster.cluster_id for cluster in artifacts.clusters
    }


def test_ghost_layout_uses_global_coordinates_for_clusters_and_members() -> None:
    dataset = _dataset()
    artifacts = prepare_layout_artifacts(dataset)
    cluster_layouts, node_positions = compute_prepared_layouts(artifacts)
    cluster_by_id = {cluster.cluster_id: cluster for cluster in artifacts.clusters}
    position_by_node = {position.node_id: position for position in node_positions}

    assert len(node_positions) == len(position_by_node)

    for layout in cluster_layouts:
        representative_node_id = cluster_by_id[layout.cluster_id].representative_node_id
        representative_position = position_by_node[representative_node_id]
        assert (layout.x, layout.y) == (
            representative_position.x,
            representative_position.y,
        )


def test_graphviz_plain_parser_handles_quoted_node_ids() -> None:
    positions = parse_graphviz_plain_positions(
        "graph 1 3 1\n"
        'node "a b" 0.5 1.25 0.1 0.1 "" solid ellipse black lightgrey\n'
        'node "c-d" 2.0 3.5 0.1 0.1 "" solid ellipse black lightgrey\n'
        "stop\n"
    )

    assert positions == {"a b": (0.5, 1.25), "c-d": (2.0, 3.5)}


def test_graphviz_sfdp_positions_applies_only_an_explicit_timeout(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class Completed:
        stdout = (
            "graph 1 3 1\n"
            'node "a" 0 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            'node "b" 1 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            "stop\n"
        )

    def fake_run(*args, **kwargs):
        calls.append(kwargs)
        return Completed()

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run",
        fake_run,
    )
    monkeypatch.setenv("PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS", "8.5")

    positions = graphviz_sfdp_positions(
        ("a", "b"),
        (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
    )

    assert positions == {"a": (0.0, 0.0), "b": (1.0, 0.0)}
    assert calls[0]["timeout"] == 8.5


def test_graphviz_sfdp_positions_has_no_default_timeout(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class Completed:
        stdout = (
            "graph 1 3 1\n"
            'node "a" 0 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            'node "b" 1 0 0.1 0.1 "" solid ellipse black lightgrey\n'
            "stop\n"
        )

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run",
        lambda *args, **kwargs: calls.append(kwargs) or Completed(),
    )
    monkeypatch.delenv("PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS", raising=False)

    graphviz_sfdp_positions(
        ("a", "b"),
        (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
    )

    assert calls[0]["timeout"] is None


def test_graphviz_sfdp_positions_timeout_fails_layout_job(monkeypatch) -> None:
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(cmd=command, timeout=kwargs["timeout"])

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run",
        fake_run,
    )
    monkeypatch.setenv("PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS", "1")

    with pytest.raises(GraphvizLayoutError) as error:
        graphviz_sfdp_positions(
            ("a", "b"),
            (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
        )
    assert error.value.diagnostics.timeout_seconds == 1


def test_graphviz_sfdp_nonzero_exit_fails_with_diagnostics(monkeypatch) -> None:
    def fake_run(command, **kwargs):
        raise subprocess.CalledProcessError(17, command, stderr="sfdp diagnostic")

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which",
        lambda command: "/usr/bin/sfdp",
    )
    monkeypatch.setattr("phylo_lens_server.pipeline.layout.subprocess.run", fake_run)

    with pytest.raises(GraphvizLayoutError) as error:
        graphviz_sfdp_positions(
            ("a", "b"),
            (GraphEdge(id="e1", source="a", target="b", distance=1.0),),
        )

    assert error.value.diagnostics.exit_status == 17
    assert error.value.diagnostics.stderr == "sfdp diagnostic"
