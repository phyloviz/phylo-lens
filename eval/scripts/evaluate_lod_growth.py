"""Offline rooted-hop LoD experiment; never imported by production.

Run: code/server/.venv/bin/python eval/scripts/evaluate_lod_growth.py
"""

from __future__ import annotations

import itertools

import json
import math
import sys
from bisect import bisect_left
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "code/server/src"))


from phylo_lens_server.data.parsers import parse_newick  # noqa: E402 - source-tree bootstrap
from phylo_lens_server.pipeline.lod import (
    clusters_at_depth,
    representation_counts,
    rooted_depths,
)  # noqa: E402 - source-tree bootstrap


def legacy_selected_depths(max_depth: int) -> tuple[int, ...]:
    """Historical PR #38 policy, retained only for offline comparison."""
    if max_depth == 0:
        return (0,)
    cuts = [0]
    depth = 1
    while depth < max_depth and len(cuts) < 11:
        cuts.append(depth)
        depth *= 2
    return (*cuts, max_depth)


def select_depths_by_representation_growth(
    depths: dict[str, int],
    gamma: float,
    *,
    policy: str = "threshold",
) -> tuple[int, ...]:
    """Select strictly growing intermediate counts; retain explicit final depth.

    Threshold chooses first R >= target. Nearest compares the two bracketing
    counts, breaks ties toward the smaller depth, and skips equal-count cuts.
    Stop when target exceeds finest size; append finest even on a plateau.
    """
    if not math.isfinite(gamma) or gamma <= 1:
        raise ValueError("gamma must be finite and greater than one")
    if policy not in ("threshold", "nearest"):
        raise ValueError("Unknown policy")
    counts = representation_counts(depths)
    maximum = len(counts) - 1
    cuts = [0]
    while cuts[-1] < maximum:
        previous = cuts[-1]
        target = gamma * counts[previous]
        if target > counts[-1]:
            break
        upper = bisect_left(counts, target, previous + 1)
        chosen = upper
        if policy == "nearest":
            lower = upper - 1
            if lower > previous and counts[lower] > counts[previous]:
                lower = bisect_left(counts, counts[lower], previous + 1)
                chosen = min((lower, upper), key=lambda d: (abs(counts[d] - target), d))
        if chosen >= maximum:
            break
        cuts.append(chosen)
    if cuts[-1] != maximum:
        cuts.append(maximum)
    return tuple(cuts)


def adjacency(nodes, edges):
    neighbors = {node: [] for node in nodes}
    for i, (a, b) in enumerate(edges):
        neighbors[a].append((b, str(i)))
        neighbors[b].append((a, str(i)))
    for links in neighbors.values():
        links.sort()
    return neighbors


def synthetic_cases():
    path = [f"p{i:05}" for i in range(12001)]
    yield "path", adjacency(path, itertools.pairwise(path)), (path[0],)
    binary = [f"b{i:05}" for i in range(8191)]
    yield (
        "balanced",
        adjacency(
            binary, ((binary[(i - 1) // 2], binary[i]) for i in range(1, len(binary)))
        ),
        (binary[0],),
    )
    star = [f"s{i:05}" for i in range(10001)]
    yield "star", adjacency(star, ((star[0], n) for n in star[1:])), (star[0],)
    nodes = ["root"]
    edges = []
    parent = "root"
    for i in range(1, 1201):
        child = f"deep{i:04}"
        nodes.append(child)
        edges.append((parent, child))
        parent = child
    for region, width in enumerate((10, 100, 1000)):
        hub = f"hub{region}"
        nodes.append(hub)
        edges.append(("root", hub))
        for i in range(width):
            child = f"shallow{region}_{i:04}"
            nodes.append(child)
            edges.append((hub, child))
    yield "irregular", adjacency(nodes, edges), ("root",)
    fixture = ROOT / "examples/newick/phyloviz-spneumoniae.nwk"
    parsed = parse_newick(fixture.read_text())
    yield (
        "phyloviz-spneumoniae",
        adjacency(parsed.nodes, ((e.source, e.target) for e in parsed.edges)),
        parsed.component_roots,
    )


def validate_cuts(neighbors, depths, cuts):
    """Independently check partitions, connectivity, boundary and refinement."""
    counts = representation_counts(depths)
    previous = None
    for d in sorted(set(cuts)):
        clusters = clusters_at_depth(neighbors, depths, d, d)
        assert len(clusters) == counts[d], (d, len(clusters), counts[d])
        owner = {}
        for i, cluster in enumerate(clusters):
            members = set(cluster.member_node_ids)
            assert len(members) == len(cluster.member_node_ids)
            for node in members:
                assert node not in owner
                owner[node] = i
            if previous is not None:
                assert len({previous[node] for node in members}) == 1
            if len(members) > 1:
                visited = {next(iter(members))}
                stack = list(visited)
                while stack:
                    for neighbor, _ in neighbors[stack.pop()]:
                        if neighbor in members and neighbor not in visited:
                            visited.add(neighbor)
                            stack.append(neighbor)
                assert visited == members
                boundary = [
                    (node, neighbor)
                    for node in members
                    for neighbor, _ in neighbors[node]
                    if neighbor not in members
                ]
                assert len(boundary) == 1
                assert cluster.representative_node_id == boundary[0][0]
                assert depths[boundary[0][0]] == d + 1
            if d == len(counts) - 1:
                assert len(members) == 1
        assert set(owner) == set(neighbors)
        previous = owner


def metrics(cuts, counts, node_count):
    sizes = [counts[d] for d in cuts]
    ratios = [b / a for a, b in itertools.pairwise(sizes)]
    return {
        "depths": list(cuts),
        "representations": sizes,
        "growth_ratios": ratios,
        "levels": len(cuts),
        "sum_representations": sum(sizes),
        "sum_over_nodes": sum(sizes) / node_count,
        "membership_rows": node_count * len(cuts),
        "max_absolute_jump": max(
            (b - a for a, b in itertools.pairwise(sizes)), default=0
        ),
        "max_multiplicative_jump": max(ratios, default=1),
    }


def main():
    results = {}
    for name, neighbors, roots in synthetic_cases():
        depths = rooted_depths(neighbors, roots)
        histogram = Counter(depths.values())
        counts = representation_counts(depths)
        policies = {"CURRENT": legacy_selected_depths(max(depths.values()))}
        for gamma in (1.5, 2.0, 2.5):
            for policy in ("threshold", "nearest"):
                policies[f"{policy} gamma={gamma}"] = (
                    select_depths_by_representation_growth(depths, gamma, policy=policy)
                )
        validate_cuts(
            neighbors, depths, [d for cuts in policies.values() for d in cuts]
        )
        # Run-length encoding reports every histogram bin without 12,001 entries.
        runs = []
        for d in range(len(counts)):
            if runs and runs[-1][2] == histogram[d]:
                runs[-1][1] = d
            else:
                runs.append([d, d, histogram[d]])
        results[name] = {
            "max_depth": len(counts) - 1,
            "node_count": len(neighbors),
            "histogram_runs": runs,
            "invariants": "passed at all selected depths",
            "policies": {
                key: metrics(cuts, counts, len(neighbors))
                for key, cuts in policies.items()
            },
        }
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
