"""Compare a private typing input, a PHYLOViZ Online JSON export and pinned PhyloLib.

Only aggregate counts and hashes are printed. Input files, IDs and allele values
remain local. The Online export need not contain a stored distance matrix: its
filtered profiles are checked and used to reconstruct all representative pairs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from collections import Counter
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "code/server/src"))

from phylo_lens_server.data.parsers import parse_newick_forest, slugify_label
from phylo_lens_server.data.typing_profiles import (
    collapse_profile_graph,
    prepare_typing_profiles,
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def hamming(left, right) -> int:
    return sum(a != b for a, b in zip(left, right, strict=True))


def read_matrix(text: str, expected_ids: set[str]) -> dict[tuple[str, str], int]:
    lines = text.splitlines()
    require(
        bool(lines) and int(lines[0]) == len(expected_ids),
        "Matrix profile count differs.",
    )
    rows = [line.split("\t") for line in lines[1:]]
    ids = [row[0] for row in rows]
    require(
        len(ids) == len(expected_ids) and set(ids) == expected_ids,
        "Matrix identifiers differ.",
    )
    distances = {}
    for i, row in enumerate(rows):
        require(
            len(row) == i + 1,
            "Matrix must be strict lower triangular without a diagonal.",
        )
        for j, value in enumerate(row[1:]):
            number = float(value)
            require(
                math.isfinite(number) and number >= 0 and number.is_integer(),
                "Invalid Hamming distance.",
            )
            distances[tuple(sorted((ids[i], ids[j])))] = int(number)
    return distances


def spanning_weights(node_ids, edges, *, minimum=False) -> list[int]:
    """Kruskal certificate independent of goeBURST tie-breaking."""
    parents = {node_id: node_id for node_id in node_ids}

    def root(node_id):
        while parents[node_id] != node_id:
            parents[node_id] = parents[parents[node_id]]
            node_id = parents[node_id]
        return node_id

    weights = []
    for source, target, weight in sorted(edges, key=lambda edge: edge[2]):
        require(
            source in parents and target in parents, "Tree contains an unknown profile."
        )
        left, right = root(source), root(target)
        if left == right:
            require(minimum, "Tree contains a cycle or duplicate edge.")
            continue
        parents[left] = right
        weights.append(weight)
    require(len(weights) == len(parents) - 1, "Tree is disconnected.")
    return weights


def audit(content: str, reference: dict, matrix_text: str, newick: str) -> dict:
    prepared = prepare_typing_profiles(content)
    membership = prepared.membership()
    raw_rows = list(
        csv.reader(content.removeprefix("\ufeff").splitlines(), delimiter="\t")
    )
    raw_rows = [[cell.strip() for cell in row] for row in raw_rows if row]
    header, *rows = raw_rows
    raw = {row[0]: row[1:] for row in rows}
    retained = [
        i for i in range(len(header) - 1) if all(row[i] != "0" for row in raw.values())
    ]
    loci = [header[i + 1] for i in retained]
    expected = {key: [row[i] for i in retained] for key, row in raw.items()}
    actual = {
        row[0]: row[1:]
        for row in list(csv.reader(prepared.content.splitlines(), delimiter="\t"))[1:]
    }
    require(
        actual == expected,
        "Preprocessing differs from independent global zero-locus deletion.",
    )
    canonical = {slugify_label(key): value for key, value in expected.items()}
    matrix = read_matrix(matrix_text, set(canonical))
    require(
        all(
            value == hamming(canonical[a], canonical[b])
            for (a, b), value in matrix.items()
        ),
        "PhyloLib matrix differs from independent Hamming distances.",
    )

    require(
        reference["usedLoci"] == {header[i + 1]: i for i in retained},
        "Online retained loci differ.",
    )
    require(
        [item["gene"] for item in reference["goeBURSTschemeGenesExport"]] == loci,
        "Online retained locus order differs.",
    )
    require(
        reference["goeburstprofilesize"] == len(loci), "Online profile width differs."
    )
    require(
        {int(i) for i in reference["indexesToRemove"]}
        == set(range(len(header) - 1)) - set(retained),
        "Online excluded locus positions differ.",
    )
    nodes, subsets = reference["nodes"], reference["subsetProfiles"]
    require(
        len(nodes) == len(subsets) == len(membership), "Online profile count differs."
    )
    online = {}
    originals = {}
    for node, subset in zip(nodes, subsets, strict=True):
        key = node["key"]
        require(
            key in raw and key not in online,
            "Unknown or duplicated Online representative.",
        )
        require(
            node["profile"] == raw[key],
            "Online source profile differs from the supplied input.",
        )
        require(subset["profile"] == expected[key], "Online filtered profile differs.")
        online[key] = subset["profile"]
        for item in [node, *reference["mergedNodes"][key]]:
            require(
                item["key"] not in originals
                and item["profile"] == raw.get(item["key"]),
                "Online original profiles differ or repeat.",
            )
            originals[item["key"]] = key
    require(set(originals) == set(raw), "Online original-isolate coverage differs.")
    require(
        reference["sameNodeHas"] == originals, "Online membership exports disagree."
    )
    profile_for = {
        original: node_id
        for node_id, members in membership.items()
        for original, _ in members
    }
    require(
        len({profile_for[key] for key in online}) == len(membership),
        "Online groups differ.",
    )
    require(
        all(
            profile_for[key] == profile_for[representative]
            for key, representative in originals.items()
        ),
        "Online isolate/profile membership differs.",
    )

    pair_count = 0
    complete_edges = []
    for (left, a), (right, b) in combinations(online.items(), 2):
        distance = hamming(a, b)
        require(
            distance
            == matrix[tuple(sorted((slugify_label(left), slugify_label(right))))],
            "Online reconstructed pair distance differs from PhyloLib.",
        )
        complete_edges.append((profile_for[left], profile_for[right], distance))
        pair_count += 1
    online_edges = []
    for edge in reference["links"]:
        a, b = edge["source"], edge["target"]
        require(a in online and b in online, "Online edge has unknown endpoints.")
        require(
            type(edge["value"]) in (int, float)
            and edge["value"] == hamming(online[a], online[b]),
            "Online exported edge distance differs from Hamming.",
        )
        online_edges.append((profile_for[a], profile_for[b], int(edge["value"])))
    graph = collapse_profile_graph(parse_newick_forest(newick), membership)
    require(
        set(graph.nodes) == set(membership), "PhyloLib tree profile coverage differs."
    )
    local_edges = [(edge.source, edge.target, edge.distance) for edge in graph.edges]
    profiles = {
        node_id: canonical[members[0][1]] for node_id, members in membership.items()
    }
    require(
        all(
            weight == hamming(profiles[a], profiles[b]) for a, b, weight in local_edges
        ),
        "PhyloLib tree edge differs from Hamming.",
    )
    minimum = spanning_weights(membership, complete_edges, minimum=True)
    local_weights = spanning_weights(membership, local_edges)
    online_weights = spanning_weights(membership, online_edges)
    require(
        local_weights == online_weights == minimum,
        "Trees do not share the minimum spanning weight spectrum.",
    )
    edge_keys = lambda edges: {tuple(sorted((a, b))) for a, b, _ in edges}
    shared = len(edge_keys(local_edges) & edge_keys(online_edges))
    return {
        "status": "pass",
        "isolate_count": len(raw),
        "profile_count": len(membership),
        "input_locus_count": len(header) - 1,
        "retained_locus_count": len(loci),
        "excluded_locus_count": len(header) - 1 - len(loci),
        "phylolib_pairs_checked": len(matrix),
        "online_reconstructed_pairs_checked": pair_count,
        "pair_distance_mismatches": 0,
        "online_original_profiles_checked": len(originals),
        "tree_edge_count": len(local_edges),
        "shared_tree_edges": shared,
        "alternative_tree_edges_per_tree": len(local_edges) - shared,
        "tree_max_edge_distance": max(minimum, default=0),
        "tree_total_distance": sum(minimum),
        "tree_edge_weight_histogram": dict(sorted(Counter(minimum).items())),
        "minimum_spanning_certificate": "both trees match independent Kruskal weights",
        "online_pair_source": "Hamming reconstructed from verified subsetProfiles; not a stored Online matrix",
    }


def run_phylolib(prepared, jar: Path, java: str) -> tuple[str, str]:
    with tempfile.TemporaryDirectory(prefix="phylo-distance-audit-") as directory:
        root = Path(directory)
        profiles, matrix, tree = (
            root / name for name in ("profiles.tsv", "matrix.txt", "tree.nwk")
        )
        profiles.write_text(prepared.algorithm_content())
        for command in (
            [
                "distance",
                "hamming",
                f"--dataset=ml:{profiles}",
                f"--out=symmetric:{matrix}",
            ],
            [
                "algorithm",
                "goeburstfullmst",
                f"--matrix=symmetric:{matrix}",
                f"--out=newick:{tree}",
            ],
        ):
            subprocess.run(
                [java, "-jar", str(jar), *command],
                check=True,
                capture_output=True,
                timeout=120,
            )
        return matrix.read_text(), tree.read_text()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profiles", type=Path)
    parser.add_argument("online_json", type=Path)
    parser.add_argument("--phylolib-jar", type=Path, required=True)
    parser.add_argument("--java", default="java")
    args = parser.parse_args()
    sha = lambda data: hashlib.sha256(data).hexdigest()
    jar_hash = sha(args.phylolib_jar.read_bytes())
    require(
        jar_hash == (ROOT / "code/server/phylolib.jar.sha256").read_text().strip(),
        "PhyloLib JAR is not the repository-pinned build.",
    )
    raw, reference = args.profiles.read_bytes(), args.online_json.read_bytes()
    content = raw.decode("utf-8-sig")
    matrix, tree = run_phylolib(
        prepare_typing_profiles(content), args.phylolib_jar.resolve(), args.java
    )
    report = audit(content, json.loads(reference), matrix, tree)
    report.update(
        profiles_sha256=sha(raw),
        online_export_sha256=sha(reference),
        phylolib_sha256=jar_hash,
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
