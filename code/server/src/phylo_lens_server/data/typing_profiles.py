"""Validate typing matrices and select one shared set of comparable loci."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from io import StringIO
from pathlib import Path

from phylo_lens_server.data.parsers import (
    ParsedEdge,
    ParsedGraph,
    ParseError,
    slugify_label,
)


@dataclass(frozen=True)
class PreparedTypingProfiles:
    content: str
    retained_loci: tuple[str, ...]
    excluded_loci: tuple[str, ...]

    def membership(self) -> dict[str, list[tuple[str, str]]]:
        """Map a stable profile node to (original ID, canonical isolate ID)."""
        rows = list(csv.reader(StringIO(self.content), delimiter="\t"))[1:]
        groups: dict[tuple[str, ...], list[tuple[str, str]]] = {}
        canonical_ids: set[str] = set()
        for row in rows:
            node_id = slugify_label(row[0])
            if not node_id or node_id.startswith("union_"):
                raise ParseError(
                    "Typing identifiers must normalize to non-empty, non-structural node IDs."
                )
            if node_id in canonical_ids:
                raise ParseError(
                    "Typing identifiers collide after canonical normalization."
                )
            canonical_ids.add(node_id)
            groups.setdefault(tuple(row[1:]), []).append((row[0], node_id))
        return {
            min(node_id for _, node_id in members): sorted(members)
            for members in groups.values()
        }

    def algorithm_content(self) -> str:
        """Safe labels for the Newick boundary, with duplicate profiles retained."""
        rows = list(csv.reader(StringIO(self.content), delimiter="\t"))
        output = StringIO()
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(rows[0])
        for row in rows[1:]:
            writer.writerow([slugify_label(row[0]), *row[1:]])
        return output.getvalue()

    @property
    def provenance(self) -> str:
        return json.dumps(
            {
                "typing_missing_loci_policy": "exclude_loci_with_zero",
                "retained_loci": self.retained_loci,
                "excluded_loci": self.excluded_loci,
            },
            sort_keys=True,
        )

    @property
    def warnings(self) -> list[str]:
        if not self.excluded_loci:
            return []
        return [
            (
                f"Excluded {len(self.excluded_loci)} loci containing allele 0 in at "
                f"least one profile; retained {len(self.retained_loci)} loci. "
                f"Excluded loci: {', '.join(self.excluded_loci)}."
            )
        ]


def prepare_typing_profiles(content: str) -> PreparedTypingProfiles:
    """Apply complete-locus deletion, never pairwise missing-value deletion.

    Alleles remain categorical strings. Only the explicit token ``0`` denotes
    a missing allele; blank cells are rejected rather than assigned semantics.
    Membership and profile frequencies are preserved for downstream goeBURST.
    """
    try:
        rows = [
            [cell.strip() for cell in row]
            for row in csv.reader(
                StringIO(content.removeprefix("\ufeff")), delimiter="\t", strict=True
            )
            if row
        ]
    except csv.Error as error:
        raise ParseError(f"Invalid typing-data TSV: {error}") from error
    if len(rows) < 2 or len(rows[0]) < 2:
        raise ParseError(
            "Typing data requires a TSV header, an identifier column, "
            "at least one locus and at least one profile."
        )

    header, *profiles = rows
    if any(not name for name in header) or len(set(header)) != len(header):
        raise ParseError("Typing-data column names must be non-empty and unique.")

    seen_ids: set[str] = set()
    for row_number, row in enumerate(profiles, start=2):
        if len(row) != len(header):
            raise ParseError(
                f"Typing-data row {row_number} has {len(row)} columns; "
                f"expected {len(header)}."
            )
        if any(not cell for cell in row):
            raise ParseError(
                f"Typing-data row {row_number} contains an empty cell; "
                "use 0 for missing alleles."
            )
        if row[0] in seen_ids:
            raise ParseError(f"Duplicate typing-data identifier '{row[0]}'.")
        seen_ids.add(row[0])

    excluded = {
        index
        for index in range(1, len(header))
        if any(row[index] == "0" for row in profiles)
    }
    retained = [index for index in range(1, len(header)) if index not in excluded]
    if not retained:
        raise ParseError(
            "No comparable loci remain: every locus contains allele 0 "
            "in at least one profile."
        )

    output = StringIO()
    writer = csv.writer(output, delimiter="\t", lineterminator="\n")
    for row in rows:
        writer.writerow([row[0], *(row[index] for index in retained)])
    return PreparedTypingProfiles(
        content=output.getvalue(),
        retained_loci=tuple(header[index] for index in retained),
        excluded_loci=tuple(header[index] for index in sorted(excluded)),
    )


def collapse_profile_graph(
    graph: ParsedGraph, membership: dict[str, list[tuple[str, str]]]
) -> ParsedGraph:
    """Contract known equivalent typing profiles, never arbitrary zero edges."""
    representative = {
        isolate_id: node_id
        for node_id, members in membership.items()
        for _, isolate_id in members
    }
    if set(representative) - set(graph.nodes):
        raise ParseError(
            "PhyloLib output omitted typing identifiers; refusing to lose isolate membership."
        )
    if (
        set(graph.nodes) - set(representative)
        or set(graph.nodes) - graph.explicit_node_ids
    ):
        raise ParseError(
            "PhyloLib output contains nodes that are not typing profiles; "
            "a Newick serialization junction cannot be used as an ST."
        )
    edges: dict[tuple[str, str], ParsedEdge] = {}
    for edge in graph.edges:
        source = representative.get(edge.source, edge.source)
        target = representative.get(edge.target, edge.target)
        if source == target:
            if edge.distance != 0:
                raise ParseError(
                    "Equivalent typing profiles have a non-zero PhyloLib edge."
                )
            continue
        key = tuple(sorted((source, target)))
        if key in edges and edges[key].distance != edge.distance:
            raise ParseError("Contracted typing edges have conflicting distances.")
        edges.setdefault(key, ParsedEdge(*key, edge.distance))
    return ParsedGraph(
        nodes=sorted({representative.get(node_id, node_id) for node_id in graph.nodes}),
        edges=[edges[key] for key in sorted(edges)],
        component_roots=tuple(
            dict.fromkeys(representative[root] for root in graph.component_roots)
        ),
        explicit_node_ids={
            representative.get(node_id, node_id) for node_id in graph.explicit_node_ids
        },
        warnings=list(graph.warnings),
    )


def validate_goeburst_tree(
    graph: ParsedGraph, membership: dict[str, list[tuple[str, str]]]
) -> None:
    """A Full MST must span the distinct profiles as one tree."""
    if set(graph.nodes) != set(membership) or len(graph.edges) != len(graph.nodes) - 1:
        raise ParseError("A goeBURST Full MST must span one connected profile tree.")
    neighbors: dict[str, list[str]] = {node_id: [] for node_id in graph.nodes}
    for edge in graph.edges:
        neighbors[edge.source].append(edge.target)
        neighbors[edge.target].append(edge.source)
    reached: set[str] = set()
    stack = [graph.nodes[0]]
    while stack:
        node = stack.pop()
        if node in reached:
            continue
        reached.add(node)
        stack.extend(
            neighbor for neighbor in neighbors[node] if neighbor not in reached
        )
    if len(reached) != len(graph.nodes):
        raise ParseError("A goeBURST Full MST must span one connected profile tree.")


def select_goeburst_root(
    matrix_path: Path,
    profiles: PreparedTypingProfiles,
    membership: dict[str, list[tuple[str, str]]],
) -> str:
    """Stream PhyloLib's triangular Hamming matrix; rank distinct profiles by LV counts."""
    rows = list(csv.reader(StringIO(profiles.content), delimiter="\t"))[1:]
    input_order = {slugify_label(row[0]): index for index, row in enumerate(rows)}
    representative = {
        isolate_id: node_id
        for node_id, members in membership.items()
        for _, isolate_id in members
    }
    counts: dict[str, dict[int, int]] = {node_id: {} for node_id in membership}
    highest_distance = 0
    previous: list[str] = []
    try:
        with matrix_path.open(encoding="utf-8", newline="") as stream:
            matrix = csv.reader(stream, delimiter="\t")
            size_row = next(matrix)
            if len(size_row) != 1 or int(size_row[0]) != len(rows):
                raise ValueError("unexpected matrix size")
            for fields in matrix:
                if len(previous) >= len(rows) or len(fields) != len(previous) + 1:
                    raise ValueError("invalid triangular matrix row")
                node_id = fields[0]
                if node_id not in representative or node_id in previous:
                    raise ValueError("unknown or repeated matrix profile")
                for other, cell in zip(previous, fields[1:], strict=True):
                    number = float(cell)
                    distance = int(number)
                    if number != distance or not 0 <= distance <= len(
                        profiles.retained_loci
                    ):
                        raise ValueError("invalid Hamming distance")
                    left, right = representative[node_id], representative[other]
                    if left == right:
                        if distance != 0:
                            raise ValueError(
                                "equivalent profiles have nonzero distance"
                            )
                    elif distance == 0:
                        raise ValueError("distinct profiles have zero distance")
                    elif node_id == left and other == right:
                        highest_distance = max(highest_distance, distance)
                        counts[left][distance] = counts[left].get(distance, 0) + 1
                        counts[right][distance] = counts[right].get(distance, 0) + 1
                previous.append(node_id)
        if set(previous) != set(representative):
            raise ValueError("matrix omitted typing profiles")
    except (OSError, ValueError, OverflowError, StopIteration, csv.Error) as error:
        raise ParseError(f"Invalid PhyloLib Hamming matrix: {error}") from error

    return min(
        counts,
        key=lambda node: (
            tuple(
                -counts[node].get(distance, 0)
                for distance in range(1, highest_distance + 1)
            ),
            min(input_order[isolate_id] for _, isolate_id in membership[node]),
        ),
    )
