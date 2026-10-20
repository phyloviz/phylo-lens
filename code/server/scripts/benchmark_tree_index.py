"""Reproducible topology-index microbenchmark; excludes layout and persistence.

Run from code/server: .venv/bin/python scripts/benchmark_tree_index.py
Timings are observations, not CI thresholds or end-to-end latency claims.
"""

import json
import platform
from functools import partial
from statistics import median
from time import perf_counter

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset, DatasetSource, GraphEdge, GraphNode
from phylo_lens_server.pipeline.lod import prepare_layout_artifacts
from phylo_lens_server.pipeline.tree_index import index_forest


def adjacency(size, shape):
    neighbors = {str(i): [] for i in range(size)}
    roots = ["0"]
    for i in range(1, size):
        if shape == "forest" and i % 64 == 0:
            roots.append(str(i))
            continue
        parent = 0 if shape == "star" else i - 1
        neighbors[str(parent)].append((str(i), str(i)))
        neighbors[str(i)].append((str(parent), str(i)))
    return neighbors, tuple(roots)


def timed(action, repeats=5):
    samples = []
    for _ in range(repeats):
        start = perf_counter()
        action()
        samples.append((perf_counter() - start) * 1000)
    return round(median(samples), 3)


def main():
    rows = []
    for shape in ("chain", "star", "forest"):
        for size in (10000, 50000, 100000):
            neighbors, roots = adjacency(size, shape)
            rows.append(
                {
                    "shape": shape,
                    "nodes": size,
                    "index_median_ms": timed(partial(index_forest, neighbors, roots)),
                }
            )
    # Repeated components on both sides of candidate limits. A larger limit
    # trades more explicit representations for fewer automatic tiers.
    nodes, edges, roots = [], [], []
    for component in range(100):
        size = (16, 48, 96, 256)[component % 4]
        prefix = f"c{component}_"
        roots.append(prefix + "0")
        for i in range(size):
            nodes.append(GraphNode(id=prefix + str(i)))
            if i:
                edges.append(
                    GraphEdge(
                        id=prefix + f"e{i}",
                        source=prefix + str(i - 1),
                        target=prefix + str(i),
                        distance=1,
                    )
                )
    dataset = Dataset(
        dataset_id="benchmark",
        nodes=tuple(nodes),
        edges=tuple(edges),
        technical_roots=tuple(roots),
        source=DatasetSource(
            format="newick",
            generated_at="fixed",
            rooting_strategy="newick-component-root-v1",
        ),
    )
    policies = []
    for limit in (32, 64, 128):
        options = LodOptions(small_component_threshold=limit)
        artifacts = prepare_layout_artifacts(dataset, lod_options=options)
        policies.append(
            {
                "threshold": limit,
                "coarsest_representations": sum(
                    c.lod_level == 0 for c in artifacts.clusters
                ),
                "prepare_median_ms": timed(
                    partial(prepare_layout_artifacts, dataset, lod_options=options), 3
                ),
            }
        )
    print(
        json.dumps(
            {
                "python": platform.python_version(),
                "index": rows,
                "policy_forest_nodes": len(nodes),
                "policies": policies,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
