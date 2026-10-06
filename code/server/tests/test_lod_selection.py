"""Structural cut counts and production representation-growth selection."""

import itertools
import random
from math import log
from pathlib import Path

import pytest

from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.lod import (
    clusters_at_depth,
    prepare_layout_artifacts,
    representation_counts,
    rooted_depths,
    selected_depths,
    tree_adjacency,
)


def assert_hierarchy(neighbors, depths, cuts):
    counts = representation_counts(depths)
    previous = None
    for depth in cuts:
        clusters = clusters_at_depth(neighbors, depths, depth, depth)
        assert len(clusters) == counts[depth]
        owner = {}
        for i, cluster in enumerate(clusters):
            members = set(cluster.member_node_ids)
            assert len(members) == cluster.member_count
            assert not members.intersection(owner)
            if previous is not None:
                assert len({previous[node] for node in members}) == 1
            owner.update({node: i for node in members})
            if len(members) > 1:
                seen = {next(iter(members))}
                pending = list(seen)
                while pending:
                    for neighbor, _ in neighbors[pending.pop()]:
                        if neighbor in members and neighbor not in seen:
                            seen.add(neighbor)
                            pending.append(neighbor)
                assert seen == members
                boundary = [
                    (a, b) for a in members for b, _ in neighbors[a] if b not in members
                ]
                assert len(boundary) == 1
                assert boundary[0][0] == cluster.representative_node_id
                assert depths[boundary[0][0]] == depth + 1
            if depth == max(depths.values()):
                assert cluster.member_count == 1
        assert set(owner) == set(neighbors)
        previous = owner


def test_formula_and_refinement_at_every_cut_of_deterministic_forests():
    rng = random.Random(38)
    for size in range(1, 50):
        neighbors = {str(i): [] for i in range(size)}
        roots = ["0"]
        for i in range(1, size):
            if rng.random() < 0.15:
                roots.append(str(i))
            else:
                parent = str(rng.randrange(i))
                neighbors[parent].append((str(i), str(i)))
                neighbors[str(i)].append((parent, str(i)))
        depths = rooted_depths(neighbors, tuple(roots))
        assert all(depths[r] == 0 for r in roots)
        assert all(
            abs(depths[a] - depths[b]) == 1 for a in neighbors for b, _ in neighbors[a]
        )
        assert_hierarchy(neighbors, depths, range(max(depths.values()) + 1))
        for gamma in (1.5, 2, 2.5):
            cuts = selected_depths(depths, gamma)
            assert tuple(sorted(set(cuts))) == cuts
            assert cuts[-1] == max(depths.values())
            assert cuts == selected_depths(dict(reversed(list(depths.items()))), gamma)
            counts = representation_counts(depths)
            assert all(counts[a] < counts[b] for a, b in itertools.pairwise(cuts))
            assert_hierarchy(neighbors, depths, cuts)


def test_path_has_no_cap_and_uses_geometric_growth():
    depths = {str(i): i for i in range(12_001)}
    cuts = selected_depths(depths)
    assert cuts == (0, 2, 6, 14, 30, 62, 126, 254, 510, 1022, 2046, 4094, 8190, 12000)
    assert len(cuts) > 12
    counts = representation_counts(depths)
    assert all(counts[b] == 2 * counts[a] for a, b in itertools.pairwise(cuts[:-1]))


def test_multiplicative_nearest_differs_from_absolute_nearest():
    # R = (2, 3, 5, 5). Target=4: absolute errors tie, log-space picks 5.
    depths = {"r": 0, "a": 1, "b": 2, "c": 3, "d": 3}
    assert abs(log(5 / 4)) < abs(log(3 / 4))
    assert representation_counts(depths) == (2, 3, 5, 5)
    assert selected_depths(depths) == (0, 3)


def test_log_ties_prefer_smaller_depth_and_final_plateau_is_removed():
    # At R=2 with gamma=3, target=6 brackets 3 and 12 symmetrically.
    depths = {"r": 0, "a": 1, "b": 2, **{str(i): 3 for i in range(9)}}
    assert selected_depths(depths, 3) == (0, 1, 3)
    assert selected_depths({"r": 0}, 2) == (0,)
    assert selected_depths({"r": 0, "a": 1}, 2) == (1,)
    assert selected_depths({"r": 0, "a": 1, "b": 2}, 1.01) == (0, 2)


@pytest.mark.parametrize("factor", [0, 1, -1, float("nan"), float("inf")])
def test_invalid_growth_factor(factor):
    with pytest.raises(ValueError):
        selected_depths({"r": 0}, factor)


@pytest.mark.parametrize("depths", [{}, {"r": -1}, {"r": 1}, {"r": 0, "a": 2}])
def test_invalid_depth_histogram(depths):
    with pytest.raises(ValueError):
        representation_counts(depths)


def test_existing_real_newick_fixture():
    fixture = (
        Path(__file__).resolve().parents[3] / "examples/newick/phyloviz-spneumoniae.nwk"
    )
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="real-lod-fixture",
            content=fixture.read_text(),
        ).to_domain()
    ).dataset
    neighbors = tree_adjacency(dataset)
    depths = rooted_depths(neighbors, dataset.technical_roots)
    cuts = selected_depths(depths)
    assert len(dataset.nodes) == 379
    assert max(depths.values()) == 25
    assert cuts[-1] == 25
    assert_hierarchy(neighbors, depths, cuts)
    artifacts = prepare_layout_artifacts(dataset)
    assert len(artifacts.clusters) == sum(
        representation_counts(depths)[d] for d in cuts
    )


def test_real_fixture_preparation_and_unbounded_reads(tmp_path):
    from phylo_lens_server.repository.layout.sqlite_layout_repository import (
        SQLiteLayoutRepository,
    )
    from phylo_lens_server.services.preparation import PreparationService

    fixture = (
        Path(__file__).resolve().parents[3] / "examples/newick/phyloviz-spneumoniae.nwk"
    )
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="real-prepared-fixture",
            content=fixture.read_text(),
        ).to_domain()
    ).dataset
    store = SQLiteLayoutRepository(tmp_path)
    result = PreparationService(store).prepare_dataset(dataset)
    depths = rooted_depths(tree_adjacency(dataset), dataset.technical_roots)
    cuts = selected_depths(depths)
    counts = representation_counts(depths)
    args = {
        "dataset_id": dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        "xmin": None,
        "xmax": None,
        "ymin": None,
        "ymax": None,
    }
    for level, depth in enumerate(cuts):
        read = store.read_viewport(**args, lod_level=level)
        assert len(read.nodes) == counts[depth]
        assert not read.truncated
        ids = {n.node_id for n in read.nodes}
        assert all(e.source in ids and e.target in ids for e in read.edges)
    assert {n.node_id for n in read.nodes} == {n.id for n in dataset.nodes}
    assert all(n.member_count == 1 and not n.is_representative for n in read.nodes)
