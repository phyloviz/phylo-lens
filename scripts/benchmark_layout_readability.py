"""Fixed-tree layout comparison; run with the server package on PYTHONPATH.

Reports proper straight-edge crossings and node-disc overlaps (radius 3 px),
after aspect-preserving fitting to 1000 x 700 px. Shared edge endpoints and
collinear contacts are excluded from crossings. These are synthetic geometric
probes, not biological quality or actual variable-radius renderer measurements.
"""

import json
import random
import subprocess
from itertools import combinations
from math import hypot
from time import perf_counter

from phylo_lens_server.domain.models import CanonicalEdge
from phylo_lens_server.pipeline.layout import (
    graphviz_dot_payload,
    parse_graphviz_plain_positions,
)
from phylo_lens_server.pipeline.sfdp import SfdpOptions


def metrics(positions, edges):
    xs, ys = zip(*positions.values(), strict=True)
    scale = min(1000 / max(max(xs) - min(xs), 1e-9), 700 / max(max(ys) - min(ys), 1e-9))
    points = {key: (x * scale, y * scale) for key, (x, y) in positions.items()}

    def side(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    crossings = 0
    for first, second in combinations(edges, 2):
        ids = (first.source, first.target, second.source, second.target)
        if len(set(ids)) < 4:
            continue
        a, b, c, d = (points[key] for key in ids)
        crossings += (
            side(a, b, c) * side(a, b, d) < 0 and side(c, d, a) * side(c, d, b) < 0
        )
    overlaps = sum(
        hypot(a[0] - b[0], a[1] - b[1]) < 6 for a, b in combinations(points.values(), 2)
    )
    return {"crossings": crossings, "overlaps": overlaps}


def main():
    rng = random.Random(42)
    trees = {
        "balanced-127": [(i, (i - 1) // 2) for i in range(1, 127)],
        "star-127": [(i, 0) for i in range(1, 127)],
        "caterpillar-126": [(i, i - 1) for i in range(1, 63)]
        + [(i + 63, i) for i in range(63)],
        "random-127": [(i, rng.randrange(i)) for i in range(1, 127)],
    }
    variants = {
        "sfdp-current": ("sfdp", SfdpOptions()),
        "sfdp-no-smoothing": ("sfdp", SfdpOptions(smoothing="none")),
        "sfdp-prism500": ("sfdp", SfdpOptions(prismIterations=500)),
        "twopi-root0": ("twopi", SfdpOptions()),
    }
    rows = []
    for tree, pairs in trees.items():
        edges = tuple(
            CanonicalEdge(id=str(i), source=str(a), target=str(b), distance=1)
            for i, (a, b) in enumerate(pairs)
        )
        nodes = tuple(
            sorted({node for edge in edges for node in (edge.source, edge.target)})
        )
        for name, (engine, options) in variants.items():
            dot = graphviz_dot_payload(nodes, edges, options).replace(
                "graph {", 'graph { graph [start=42, root="0"];', 1
            )
            started = perf_counter()
            result = subprocess.run(
                [engine, "-Tplain"],
                input=dot,
                text=True,
                capture_output=True,
                check=True,
                timeout=60,
            )
            elapsed = perf_counter() - started
            rows.append(
                {
                    "tree": tree,
                    "layout": name,
                    **metrics(parse_graphviz_plain_positions(result.stdout), edges),
                    "seconds": round(elapsed, 4),
                }
            )
    version = subprocess.run(["sfdp", "-V"], capture_output=True, text=True, check=True)
    print(
        json.dumps(
            {
                "graphviz": version.stderr.strip(),
                "seed": 42,
                "viewport": [1000, 700],
                "node_radius": 3,
                "results": rows,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
