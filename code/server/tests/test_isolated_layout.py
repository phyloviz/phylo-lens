"""Regression: SFDP spring smoothing aborts on singleton forest components."""

import math
import shutil
import subprocess

import pytest

from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.domain.models import CanonicalEdge
from phylo_lens_server.pipeline.layout import (
    compute_global_node_positions,
    graphviz_sfdp_positions,
)
from phylo_lens_server.pipeline.sfdp import SfdpOptions


def test_isolates_keep_their_ids_without_entering_spring_smoothing(monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append(kwargs["input"])
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='node a 0 0 0.04 0.04 "" solid point black white\n'
            'node b 2 1 0.04 0.04 "" solid point black white\n',
        )

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.shutil.which", lambda _: "sfdp"
    )
    monkeypatch.setattr("phylo_lens_server.pipeline.layout.subprocess.run", run)
    edges = (
        CanonicalEdge(id="ab", source="a", target="b", distance=1.0),
        CanonicalEdge(id="loop", source="solo", target="solo", distance=0.0),
    )
    positions = graphviz_sfdp_positions(("a", "b", "solo", "isolated"), edges)

    assert 'smoothing="spring"' in calls[0]
    assert '"solo"' not in calls[0]
    assert '"isolated"' not in calls[0]
    assert positions["a"] == (0.0, 0.0)
    assert positions["b"] == (2.0, 1.0)
    assert set(positions) == {"a", "b", "solo", "isolated"}
    assert positions["solo"][0] > 2.0
    assert positions["isolated"][0] > 2.0
    assert len(set(positions.values())) == 4


def test_entirely_isolated_forest_needs_no_graphviz_and_has_stable_positions(
    monkeypatch,
):
    def unexpected_run(*args, **kwargs):
        pytest.fail("An edgeless forest must not invoke SFDP.")

    monkeypatch.setattr(
        "phylo_lens_server.pipeline.layout.subprocess.run", unexpected_run
    )
    forward = graphviz_sfdp_positions(("c", "a", "b"), ())
    reverse = graphviz_sfdp_positions(("b", "a", "c"), ())
    assert forward == reverse
    assert len(set(forward.values())) == 3
    assert graphviz_sfdp_positions((), ()) == {}


@pytest.mark.skipif(shutil.which("sfdp") is None, reason="Requires real Graphviz SFDP")
@pytest.mark.parametrize("smoothing", ["spring", "none"])
def test_real_sfdp_preserves_mixed_newick_forest(smoothing):
    # A nontrivial tree, a pair, and two singleton components. The original
    # implementation aborts with status -6 on this input with spring smoothing.
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="forest-regression",
            content="((a:1,b:1)c:1,d:1)root; (y:1)x; lonely; other;",
        )
    ).dataset
    positions = compute_global_node_positions(dataset, SfdpOptions(smoothing=smoothing))
    assert set(positions) == {node.id for node in dataset.nodes}
    assert all(math.isfinite(value) for point in positions.values() for value in point)
    assert positions["lonely"] != positions["other"]
    connected_max_x = max(
        point[0] for key, point in positions.items() if key not in {"lonely", "other"}
    )
    assert positions["lonely"][0] > connected_max_x
    assert positions["other"][0] > connected_max_x
