"""Focused offline-selector regression tests."""

import itertools

import pytest
from evaluate_lod_growth import (
    adjacency,
    representation_counts,
    select_depths_by_representation_growth,
    validate_cuts,
)
from phylo_lens_server.pipeline.clustering import rooted_depths


@pytest.mark.parametrize("policy", ["threshold", "nearest"])
@pytest.mark.parametrize("gamma", [1.5, 2.0, 2.5])
def test_path_preserves_explicit_finest_on_plateau(policy, gamma):
    depths = {str(i): i for i in range(13)}
    counts = representation_counts(depths)
    assert counts[-2:] == (13, 13)
    cuts = select_depths_by_representation_growth(depths, gamma, policy=policy)
    assert cuts[0] == 0 and cuts[-1] == 12
    assert list(cuts) == sorted(set(cuts))
    assert all(counts[b] > counts[a] for a, b in itertools.pairwise(cuts[:-1]))
    assert cuts == select_depths_by_representation_growth(depths, gamma, policy=policy)


def test_star_and_single_node():
    assert select_depths_by_representation_growth({"r": 0}, 2) == (0,)
    depths = {"r": 0, **{str(i): 1 for i in range(100)}}
    assert representation_counts(depths) == (101, 101)
    assert select_depths_by_representation_growth(depths, 2) == (0, 1)


def test_nearest_differs_on_binary_overshoot():
    depths = {str(i): d for d in range(6) for i in range(2**d - 1, 2 ** (d + 1) - 1)}
    assert select_depths_by_representation_growth(depths, 2.5) == (0, 2, 4, 5)
    assert select_depths_by_representation_growth(depths, 2.5, policy="nearest") == (
        0,
        1,
        2,
        3,
        5,
    )


def test_forest_formula_and_invariants():
    neighbors = adjacency(
        ["a", "b", "c", "x", "y", "z"], [("a", "b"), ("b", "c"), ("x", "y"), ("x", "z")]
    )
    depths = rooted_depths(neighbors, ("a", "x"))
    assert representation_counts(depths) == (5, 6, 6)
    validate_cuts(neighbors, depths, (0, 1, 2))


@pytest.mark.parametrize("gamma", [1, 0, float("nan"), float("inf")])
def test_invalid_gamma(gamma):
    with pytest.raises(ValueError):
        select_depths_by_representation_growth({"r": 0}, gamma)


@pytest.mark.parametrize("depths", [{}, {"a": -1}, {"a": 1}, {"a": 0, "b": 2}])
def test_invalid_depths(depths):
    with pytest.raises(ValueError):
        representation_counts(depths)


def test_all_cuts_of_deterministic_random_forests():
    import random

    rng = random.Random(38)
    for size in range(1, 50):
        nodes = [str(i) for i in range(size)]
        roots = [nodes[0]]
        edges = []
        for i in range(1, size):
            if rng.random() < 0.15:
                roots.append(nodes[i])
            else:
                edges.append((nodes[rng.randrange(i)], nodes[i]))
        neighbors = adjacency(nodes, edges)
        depths = rooted_depths(neighbors, tuple(roots))
        validate_cuts(neighbors, depths, range(max(depths.values()) + 1))
