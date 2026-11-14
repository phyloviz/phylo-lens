"""Exact threshold pairs without building a complete distance matrix."""

from bisect import bisect_right
from collections import defaultdict
from collections.abc import Iterator, Mapping
from decimal import Context, Decimal
from math import isfinite

from phylo_lens_server.domain.connections import ConnectionContext


def patristic_pairs(
    context: ConnectionContext, named: frozenset[str], threshold: float
) -> Iterator[tuple[str, str, float]]:
    """Centroid radius index: iterative, with O(N log N) index space.

    A pair is emitted at the unique centroid separating its branches, where the
    two stored distances sum to the exact tree-path distance. Sorted buckets
    skip points beyond the radius. No recursion or all-pairs matrix is needed.
    """
    radius = Decimal(str(threshold))
    neighbors: dict[str, list[tuple[str, Decimal]]] = {
        node: [] for node in context.node_components
    }
    weights = [radius]
    for edge in context.tree_edges:
        weight = edge.distance
        if weight is None or not isfinite(weight) or weight < 0:
            raise ValueError(
                "Tree-path connections require known, nonnegative branch lengths on every tree edge."
            )
        # Sum the canonical decimal weights so 0.1 + 0.2 qualifies at 0.3.
        decimal_weight = Decimal(str(weight))
        weights.append(decimal_weight)
        neighbors[edge.source].append((edge.target, decimal_weight))
        neighbors[edge.target].append((edge.source, decimal_weight))
    nonzero = [value for value in weights if value]
    # Enough coefficient digits for exact addition/subtraction of all canonical
    # weights, including mixed magnitudes, without changing global Decimal state.
    precision = (
        1
        if not nonzero
        else (
            max(value.adjusted() for value in nonzero)
            - min(value.as_tuple().exponent for value in nonzero)
            + len(str(len(neighbors) + 1))
            + 1
        )
    )
    arithmetic = Context(prec=precision)
    blocked: set[str] = set()
    paths: dict[str, list[tuple[str, Decimal, str | None]]] = defaultdict(list)
    buckets: dict[str, list[tuple[Decimal, str, str | None]]] = {}
    radii: dict[str, list[Decimal]] = {}
    pending = sorted(set(context.node_components.values()))
    while pending:
        start = pending.pop()
        if start in blocked:
            continue
        parents: dict[str, str | None] = {start: None}
        order = [start]
        for node in order:
            for other, _weight in neighbors[node]:
                if other != parents[node] and other not in blocked:
                    if other in parents:
                        raise ValueError(
                            "Tree-path connections require an acyclic forest."
                        )
                    parents[other] = node
                    order.append(other)
        sizes = dict.fromkeys(order, 1)
        for node in reversed(order):
            parent = parents[node]
            if parent is not None:
                sizes[parent] += sizes[node]
        center = next(
            node
            for node in order
            if max(
                [
                    len(order) - sizes[node],
                    *(
                        sizes[child]
                        for child, _ in neighbors[node]
                        if parents.get(child) == node
                    ),
                ]
            )
            <= len(order) // 2
        )
        bucket: list[tuple[Decimal, str, str | None]] = []
        if center in named:
            bucket.append((Decimal(0), center, None))
            paths[center].append((center, Decimal(0), None))
        for child, weight in neighbors[center]:
            if child in blocked:
                continue
            pending.append(child)
            stack = [(child, center, weight)]
            while stack:
                node, parent, distance = stack.pop()
                if distance > radius:
                    continue
                if node in named:
                    bucket.append((distance, node, child))
                    paths[node].append((center, distance, child))
                for other, length in neighbors[node]:
                    if other != parent and other not in blocked:
                        stack.append((other, node, arithmetic.add(distance, length)))
        bucket.sort(key=lambda entry: (entry[0], entry[1]))
        buckets[center] = bucket
        radii[center] = [entry[0] for entry in bucket]
        blocked.add(center)
    for source in sorted(named):
        # Closest centroid first: dense local results reach the caller's budget
        # before repeatedly examining ancestor buckets containing those pairs.
        for center, distance, branch in reversed(paths[source]):
            end = bisect_right(radii[center], arithmetic.subtract(radius, distance))
            for i in range(end):
                other_distance, target, other_branch = buckets[center][i]
                if source < target and (branch is None or branch != other_branch):
                    yield (
                        source,
                        target,
                        float(arithmetic.add(distance, other_distance)),
                    )


def allelic_pairs(
    profiles: Mapping[str, tuple[str, ...]], threshold: int, owners: Mapping[str, str]
) -> Iterator[tuple[str, str, float]]:
    """Pigeonhole block candidates, verified by exact categorical Hamming.

    Pairs within n mismatches share a block in an n+1 partition. Keep only one
    source's candidate set at a time. Worst-case work remains quadratic for
    adversarial/high thresholds, but no quadratic matrix is retained.
    """
    ids = sorted(profiles)
    if not ids:
        return
    loci = len(profiles[ids[0]])
    blocks = min(threshold + 1, loci)
    boundaries = [(i * loci // blocks, (i + 1) * loci // blocks) for i in range(blocks)]
    buckets: dict[tuple[str, int, tuple[str, ...]], list[str]] = defaultdict(list)
    for node in ids:
        for block, (start, end) in enumerate(boundaries):
            buckets[(owners[node], block, profiles[node][start:end])].append(node)
    for source in ids:
        if threshold >= loci:
            candidates = (
                target
                for target in ids
                if target > source and owners[target] == owners[source]
            )
        else:
            candidates = iter(
                sorted(
                    {
                        target
                        for block, (start, end) in enumerate(boundaries)
                        for target in buckets[
                            (owners[source], block, profiles[source][start:end])
                        ]
                        if target > source
                    }
                )
            )
        for target in candidates:
            differences = 0
            for left, right in zip(profiles[source], profiles[target], strict=True):
                differences += left != right
                if differences > threshold:
                    break
            if differences <= threshold:
                yield source, target, float(differences)
