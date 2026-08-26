"""Final RQ3 deterministic LoD fidelity and representation-reduction study.

This evaluation-only reader prepares one released-product SQLite layout, then
validates three persisted LoD levels against an independently parsed canonical
source graph.  It intentionally performs no browser or performance measurement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from phylo_lens_server.data.normalizer import (
    NormalizeFormat,
    NormalizeRequest,
    normalize_dataset,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

from . import SCHEMA_VERSION
from .common import (
    create_isolated_run_directory,
    utc_now,
    validate_rq3_final_observation,
    write_json,
)
from .environment import capture_environment

EXPERIMENT_ID = "rq3-lod-final-v020"
PRODUCT_RELEASE_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"
PRODUCT_RELEASE_VERSION = "0.2.0"
FINAL_RUN_ID_PATTERN = re.compile(r"^thesis-final-rq3-v020-[0-9]{3}$")
DEVELOPMENT_RUN_ID_PATTERN = re.compile(r"^dev-rq3-final-[a-z0-9-]+$")


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run final deterministic RQ3 LoD cases."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--results-root", type=Path)
    parser.add_argument("--level", action="append", type=int, dest="levels")
    args = parser.parse_args()
    try:
        print(run(args))
    except ValueError as error:
        parser.error(str(error))


def load_config(root: Path | None = None) -> dict[str, Any]:
    root = root or repository_root()
    config = json.loads((root / "eval/config/rq3-final-v020.json").read_text())
    required = {
        "schema_version",
        "id",
        "research_question",
        "product",
        "dataset",
        "lod_levels",
        "expected_persisted_level_count",
        "full_world_padding_fraction",
        "max_nodes",
        "retries",
        "canonical_serialization",
    }
    if (
        set(config) != required
        or config["schema_version"] != "1"
        or config["id"] != EXPERIMENT_ID
    ):
        raise ValueError("Final RQ3 configuration is malformed.")
    if config["product"] != {
        "version": PRODUCT_RELEASE_VERSION,
        "release_commit": PRODUCT_RELEASE_COMMIT,
    }:
        raise ValueError(
            "Final RQ3 product provenance differs from the frozen release."
        )
    if (
        config["lod_levels"] != [0, 1, 2]
        or config["expected_persisted_level_count"] != 3
    ):
        raise ValueError("Final RQ3 level matrix is not exactly levels 0, 1, and 2.")
    if config["max_nodes"] != 100000 or config["retries"] != 0:
        raise ValueError(
            "Final RQ3 maxNodes/retry policy differs from the frozen protocol."
        )
    if not 0 < config["full_world_padding_fraction"] < 1:
        raise ValueError(
            "Final RQ3 full-world padding must be a fixed positive fraction."
        )
    return config


def canonicalize(value: Any) -> Any:
    """Encode floats exactly enough for deterministic persisted-row hashes."""
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite value cannot enter canonical RQ3 evidence.")
        return {"float_hex": value.hex()}
    if isinstance(value, dict):
        return {str(key): canonicalize(item) for key, item in sorted(value.items())}
    if isinstance(value, (tuple, list, set)):
        return [canonicalize(item) for item in value]
    return value


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        canonicalize(value), sort_keys=True, separators=(",", ":")
    ).encode()


def sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_plain_json(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _source_path(root: Path, config: dict) -> Path:
    path = (
        root.parent / config["dataset"]["repository_parent_relative_path"]
    ).resolve()
    if not path.is_file():
        raise ValueError(f"Frozen RQ3 canonical input is unavailable: {path}")
    return path


def parse_canonical_source(root: Path, config: dict) -> dict[str, Any]:
    path = _source_path(root, config)
    source_bytes = path.read_bytes()
    result = normalize_dataset(
        NormalizeRequest(
            format=NormalizeFormat.NEWICK,
            dataset_name=config["dataset"]["id"],
            content=source_bytes.decode("utf-8"),
        )
    )
    dataset = result.dataset
    # The frozen canonical source checksum is the retained Newick byte stream.
    # CanonicalDataset embeds a creation timestamp, so hashing its model would
    # be non-deterministic and is deliberately not used as input provenance.
    canonical_sha = hashlib.sha256(source_bytes).hexdigest()
    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    edges = tuple(
        sorted(
            (
                edge.id,
                edge.source,
                edge.target,
                edge.distance,
            )
            for edge in dataset.edges
        )
    )
    expected = config["dataset"]
    if canonical_sha != expected["expected_canonical_sha256"]:
        raise ValueError("Canonical source SHA256 differs from the frozen RQ3 input.")
    if (
        len(node_ids) != expected["declared_node_count"]
        or len(edges) != expected["declared_edge_count"]
    ):
        raise ValueError(
            "Canonical source counts differ from the frozen RQ3 declaration."
        )
    return {
        "dataset": dataset,
        "path": str(path),
        "source_description": config["dataset"]["source_description"],
        "source_file_sha256": canonical_sha,
        "canonical_sha256": canonical_sha,
        "node_ids": node_ids,
        "node_ids_sha256": sha256(node_ids),
        "edges": edges,
        "edge_sha256": sha256(edges),
        "warnings": result.warnings,
    }


def _validate_run_id(run_id: str) -> None:
    if not (
        FINAL_RUN_ID_PATTERN.fullmatch(run_id)
        or DEVELOPMENT_RUN_ID_PATTERN.fullmatch(run_id)
    ):
        raise ValueError(
            "Run ID must be thesis-final-rq3-v020-NNN or dev-rq3-final-<slug>."
        )


def _validate_final_product_isolation(root: Path) -> None:
    checks = (
        (
            ["git", "diff", "--quiet", "--", "code/server", "code/client"],
            "Product source has unstaged changes.",
        ),
        (
            ["git", "diff", "--cached", "--quiet", "--", "code/server", "code/client"],
            "Product source has staged changes.",
        ),
        (
            [
                "git",
                "diff",
                "--quiet",
                PRODUCT_RELEASE_COMMIT,
                "--",
                "code/server",
                "code/client",
            ],
            "Product source differs from frozen v0.2.0.",
        ),
    )
    for command, message in checks:
        if subprocess.run(command, cwd=root, check=False).returncode:
            raise ValueError(message)


def run(args: argparse.Namespace) -> Path:
    _validate_run_id(args.run_id)
    root = repository_root()
    config = load_config(root)
    if FINAL_RUN_ID_PATTERN.fullmatch(args.run_id):
        _validate_final_product_isolation(root)
    source = parse_canonical_source(root, config)
    selected_levels = (
        config["lod_levels"] if not args.levels else sorted(set(args.levels))
    )
    if any(level not in config["lod_levels"] for level in selected_levels):
        raise ValueError(
            "Requested RQ3 development level is not in the frozen level matrix."
        )
    results_root = (args.results_root or root / "eval/results/raw").resolve()
    run_dir = create_isolated_run_directory(results_root, EXPERIMENT_ID, args.run_id)
    layout_root = run_dir / "prepared-layout"
    store = PreparedLayoutStore(layout_root)
    prepared = PreparedLayoutWorker(store).prepare_dataset(source["dataset"])
    layout = inspect_layout(
        store.path, source, config, prepared.artifacts.layout_version
    )
    write_json(run_dir / "resolved-config.json", config)
    write_json(run_dir / "source.json", source_record(source))
    write_json(run_dir / "layout.json", layout)
    manifest = _manifest(
        args.run_id, config, source, layout, selected_levels, "running", root
    )
    write_json(run_dir / "manifest.json", manifest)
    cases: list[dict[str, Any]] = []
    for level in selected_levels:
        case = validate_level(store, source, layout, level, args.run_id, run_dir)
        validate_rq3_final_observation(case)
        write_json(run_dir / "cases" / case["case_id"] / "observation.json", case)
        _append_jsonl(run_dir / "observations.jsonl", case)
        cases.append(case)
    write_json(run_dir / "summary.json", summarize_cases(cases))
    manifest["state"] = "completed"
    manifest["observed_terminal_cases"] = len(cases)
    manifest["success_count"] = sum(case["status"] == "success" for case in cases)
    manifest["invalid_count"] = sum(case["status"] == "invalid" for case in cases)
    manifest["failure_count"] = sum(case["status"] == "failure" for case in cases)
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def source_record(source: dict[str, Any]) -> dict[str, Any]:
    return {
        key: source[key]
        for key in (
            "path",
            "source_description",
            "source_file_sha256",
            "canonical_sha256",
            "node_ids",
            "node_ids_sha256",
            "edges",
            "edge_sha256",
            "warnings",
        )
    }


def inspect_layout(
    database: Path, source: dict[str, Any], config: dict, layout_version: str
) -> dict[str, Any]:
    dataset_id = source["dataset"].dataset_id
    with _connection(database) as connection:
        positions = _rows(
            connection,
            "select node_id, cluster_id, x, y, status from node_positions where dataset_id=? and layout_version=? order by node_id",
            (dataset_id, layout_version),
        )
        clusters = _rows(
            connection,
            "select cluster_id, threshold, representative_node_id, member_count, x, y, radius, min_x, max_x, min_y, max_y, status from prepared_clusters where dataset_id=? and layout_version=? order by threshold desc, cluster_id",
            (dataset_id, layout_version),
        )
        members = _rows(
            connection,
            "select cluster_id, node_id from cluster_members where dataset_id=? and layout_version=? order by cluster_id, node_id",
            (dataset_id, layout_version),
        )
        edges = _rows(
            connection,
            "select edge_id, source_node_id, target_node_id, distance from graph_edges where dataset_id=? and layout_version=? order by edge_id",
            (dataset_id, layout_version),
        )
        prepared_edges = _rows(
            connection,
            "select lod_level, edge_id, source_node_id, target_node_id, distance from prepared_edges where dataset_id=? and layout_version=? order by lod_level, edge_id",
            (dataset_id, layout_version),
        )
    source_ids = set(source["node_ids"])
    position_ids = {row["node_id"] for row in positions}
    if position_ids != source_ids or len(positions) != len(position_ids):
        raise ValueError(
            "Persisted node positions do not exactly cover the canonical source universe."
        )
    if any(row["status"] != "ready" for row in positions):
        raise ValueError(
            "Final RQ3 requires every persisted source position to be ready."
        )
    source_edges = {_edge_record(edge) for edge in source["edges"]}
    persisted_edges = {
        _edge_record(
            (
                row["edge_id"],
                row["source_node_id"],
                row["target_node_id"],
                row["distance"],
            )
        )
        for row in edges
    }
    if persisted_edges != source_edges:
        raise ValueError(
            "Persisted graph_edges differ from independently parsed canonical source edges."
        )
    thresholds = sorted({float(row["threshold"]) for row in clusters}, reverse=True)
    if len(thresholds) != config["expected_persisted_level_count"]:
        raise ValueError(
            "Persisted LoD level count differs from frozen final RQ3 protocol."
        )
    levels = [
        {
            "lod_level": index,
            "threshold": threshold,
            "cluster_count": sum(
                float(row["threshold"]) == threshold for row in clusters
            ),
        }
        for index, threshold in enumerate(thresholds)
    ]
    if [item["lod_level"] for item in levels] != config["lod_levels"]:
        raise ValueError(
            "Persisted LoD level identifiers differ from frozen final RQ3 matrix."
        )
    values_x = [float(row["x"]) for row in positions]
    values_y = [float(row["y"]) for row in positions]
    span = max(max(values_x) - min(values_x), max(values_y) - min(values_y))
    padding = span * float(config["full_world_padding_fraction"])
    bounds = {
        "xmin": min(values_x) - padding,
        "xmax": max(values_x) + padding,
        "ymin": min(values_y) - padding,
        "ymax": max(values_y) + padding,
        "padding": padding,
    }
    if not all(
        bounds["xmin"] <= x <= bounds["xmax"] and bounds["ymin"] <= y <= bounds["ymax"]
        for x, y in zip(values_x, values_y, strict=True)
    ):
        raise ValueError(
            "Frozen full-world bound does not contain every persisted source coordinate."
        )
    hashes = {
        "node_positions": sha256(positions),
        "prepared_clusters": sha256(clusters),
        "cluster_members": sha256(members),
        "graph_edges": sha256(edges),
        "prepared_edges": sha256(prepared_edges),
    }
    return {
        "database_path": str(database),
        "database_sha256": hashlib.sha256(database.read_bytes()).hexdigest(),
        "prepared_layout_id": layout_version,
        "levels": levels,
        "bounds": {**canonicalize(bounds), "sha256": sha256(bounds)},
        "table_sha256": hashes,
        "source_position_count": len(positions),
        "source_graph_edge_count": len(edges),
    }


def validate_level(
    store: PreparedLayoutStore,
    source: dict[str, Any],
    layout: dict,
    level: int,
    run_id: str,
    run_dir: Path,
) -> dict[str, Any]:
    dataset_id, layout_id = source["dataset"].dataset_id, layout["prepared_layout_id"]
    plain_bounds = _decode_bounds(layout["bounds"])
    view = store.read_viewport(
        dataset_id=dataset_id,
        layout_version=layout_id,
        max_nodes=100000,
        lod_level=level,
        **{key: plain_bounds[key] for key in ("xmin", "xmax", "ymin", "ymax")},
    )
    level_meta = next(item for item in layout["levels"] if item["lod_level"] == level)
    result = _validate_case(view, source, layout, level_meta, plain_bounds)
    status = "success" if not any(result["mismatches"].values()) else "invalid"
    case_id = f"lod-level-{level}"
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "experiment_id": EXPERIMENT_ID,
        "case_id": case_id,
        "status": status,
        "terminal_classification": "PASS" if status == "success" else "FAIL",
        "failure_kind": "none" if status == "success" else "semantic_fidelity_mismatch",
        "level": level_meta,
        "source": {
            "canonical_sha256": source["canonical_sha256"],
            "node_ids_sha256": source["node_ids_sha256"],
            "edge_sha256": source["edge_sha256"],
            "node_count": len(source["node_ids"]),
            "edge_count": len(source["edges"]),
        },
        "layout": {
            "prepared_layout_id": layout_id,
            "database_sha256": layout["database_sha256"],
            "table_sha256": layout["table_sha256"],
        },
        "bounds": {**layout["bounds"], "all_source_positions_contained": True},
        "membership": result["membership"],
        "positions": result["positions"],
        "full_detail": result["full_detail"],
        "quotient_connectivity": result["quotient_connectivity"],
        "reduction": result["reduction"],
        "mismatches": result["mismatches"],
        "artifacts": {"layout_database": layout["database_path"]},
        "error": None
        if status == "success"
        else "One or more deterministic RQ3 semantic invariants failed.",
    }


def _validate_case(
    view: Any,
    source: dict[str, Any],
    layout: dict,
    level_meta: dict,
    bounds: dict[str, float],
) -> dict[str, Any]:
    source_ids = set(source["node_ids"])
    source_edges = [_edge_record(edge) for edge in source["edges"]]
    positions = _load_positions(
        Path(layout["database_path"]),
        source["dataset"].dataset_id,
        layout["prepared_layout_id"],
    )
    aggregates = [node for node in view.nodes if node.member_count > 1]
    explicit_nodes = [node for node in view.nodes if node.member_count == 1]
    explicit_ids = [node.node_id for node in explicit_nodes]
    aggregate_ids = [node.node_id for node in aggregates]
    cluster_ids = [node.cluster_id for node in aggregates]
    memberships = _load_memberships(
        Path(layout["database_path"]),
        source["dataset"].dataset_id,
        layout["prepared_layout_id"],
        cluster_ids,
    )
    aggregate_members: set[str] = set()
    group_by_source: dict[str, str] = {}
    member_count_mismatches: list[dict[str, Any]] = []
    duplicate_members: list[str] = []
    for node in aggregates:
        members = memberships.get(node.cluster_id, [])
        if len(members) != len(set(members)):
            duplicate_members.append(node.cluster_id)
        if len(members) != node.member_count:
            member_count_mismatches.append(
                {
                    "cluster_id": node.cluster_id,
                    "expected": node.member_count,
                    "actual": len(members),
                }
            )
        for member in members:
            if member in group_by_source:
                duplicate_members.append(member)
            group_by_source[member] = node.node_id
            aggregate_members.add(member)
    duplicate_explicit = sorted(
        {item for item in explicit_ids if explicit_ids.count(item) > 1}
    )
    duplicate_aggregates = sorted(
        {item for item in aggregate_ids if aggregate_ids.count(item) > 1}
    )
    explicit_set = set(explicit_ids)
    overlap = sorted(explicit_set & aggregate_members)
    for node_id in explicit_set:
        if node_id in group_by_source:
            duplicate_members.append(node_id)
        group_by_source[node_id] = node_id
    observed_set = explicit_set | aggregate_members
    missing_ids = sorted(source_ids - observed_set)
    extra_ids = sorted(observed_set - source_ids)
    group_missing = sorted(source_ids - set(group_by_source))
    position_mismatches = []
    comparison_rows = []
    for node in aggregates:
        source_position = positions.get(node.node_id)
        observed = (float(node.x), float(node.y))
        expected = source_position[0:2] if source_position else None
        comparison_rows.append((node.cluster_id, node.node_id, observed, expected))
        if expected != observed:
            position_mismatches.append(
                {
                    "cluster_id": node.cluster_id,
                    "representative_node_id": node.node_id,
                    "observed": observed,
                    "expected": expected,
                }
            )
    full_position_missing = sorted(source_ids - set(positions))
    full_edge_set = {_edge_record(edge) for edge in source_edges}
    expected_quotient, support, unmapped_source_edges = _expected_quotient(
        source_edges, group_by_source
    )
    observed_quotient = {_edge_pair(edge.source, edge.target) for edge in view.edges}
    missing_quotient = sorted(expected_quotient - observed_quotient)
    unsupported_quotient = sorted(observed_quotient - expected_quotient)
    serialized_lod = _representation_payload(view)
    full_payload = _full_payload(source["node_ids"], positions, source_edges, bounds)
    visual_nodes, visual_edges, triangles = (
        len(view.nodes),
        len(view.edges),
        len(aggregates),
    )
    primitives = visual_nodes + visual_edges + triangles
    full_primitives = len(source_ids) + len(source_edges)
    mismatches = {
        "truncated": ["viewport response truncated"] if view.truncated else [],
        "duplicate_explicit_ids": duplicate_explicit,
        "duplicate_aggregate_representative_ids": duplicate_aggregates,
        "duplicate_or_overlapping_members": sorted(set(duplicate_members)),
        "explicit_member_overlap": overlap,
        "member_count": member_count_mismatches,
        "missing_source_ids": missing_ids,
        "extra_source_ids": extra_ids,
        "group_mapping_missing": group_missing,
        "representative_positions": position_mismatches,
        "full_detail_positions": full_position_missing,
        "unmapped_source_edges": unmapped_source_edges,
        "missing_quotient_edges": missing_quotient,
        "unsupported_quotient_edges": unsupported_quotient,
    }
    return {
        "membership": {
            "expected_source_ids": sorted(source_ids),
            "expected_source_ids_sha256": sha256(sorted(source_ids)),
            "observed_represented_ids": sorted(observed_set),
            "observed_represented_ids_sha256": sha256(sorted(observed_set)),
            "explicit_ids": sorted(explicit_set),
            "explicit_ids_sha256": sha256(sorted(explicit_set)),
            "aggregate_representative_ids": sorted(aggregate_ids),
            "aggregate_cluster_ids": sorted(cluster_ids),
            "cluster_memberships": {
                key: sorted(value) for key, value in sorted(memberships.items())
            },
            "cluster_memberships_sha256": sha256(
                {key: sorted(value) for key, value in sorted(memberships.items())}
            ),
            "aggregate_member_ids": sorted(aggregate_members),
            "aggregate_member_ids_sha256": sha256(sorted(aggregate_members)),
            "expected_count": len(source_ids),
            "observed_count": len(observed_set),
            "member_count_checks_pass": not member_count_mismatches,
        },
        "positions": {
            "canonical_position_rows_sha256": sha256(
                sorted((node_id, *position) for node_id, position in positions.items())
            ),
            "representative_comparisons_sha256": sha256(comparison_rows),
            "representative_comparison_count": len(comparison_rows),
            "mismatch_count": len(position_mismatches),
        },
        "full_detail": {
            "source_node_ids_sha256": sha256(sorted(source_ids)),
            "source_edge_set_sha256": sha256(sorted(full_edge_set)),
            "source_position_rows_sha256": sha256(
                sorted((node_id, *position) for node_id, position in positions.items())
            ),
            "node_count": len(source_ids),
            "edge_count": len(source_edges),
            "canonical_serialized_representation_bytes": len(
                canonical_bytes(full_payload)
            ),
        },
        "quotient_connectivity": {
            "source_to_visual_group": dict(sorted(group_by_source.items())),
            "source_to_visual_group_sha256": sha256(sorted(group_by_source.items())),
            "expected_edge_set": sorted(expected_quotient),
            "expected_edge_set_sha256": sha256(sorted(expected_quotient)),
            "observed_edge_set": sorted(observed_quotient),
            "observed_edge_set_sha256": sha256(sorted(observed_quotient)),
            "support": {
                "%s|%s" % edge: {
                    "source_edge_count": len(rows),
                    "source_edge_ids_sha256": sha256(sorted(row[0] for row in rows)),
                }
                for edge, rows in sorted(support.items())
            },
            "expected_edge_count": len(expected_quotient),
            "observed_edge_count": len(observed_quotient),
        },
        "reduction": {
            "represented_source_nodes": len(source_ids),
            "materialized_visual_nodes": visual_nodes,
            "materialized_edges": visual_edges,
            "triangle_proxy_count": triangles,
            "visual_primitives": primitives,
            "full_detail_primitives": full_primitives,
            "materialization_ratio": visual_nodes / len(source_ids),
            "node_reduction_factor": len(source_ids) / visual_nodes,
            "primitive_reduction_ratio": 1 - primitives / full_primitives,
            "materialized_edge_reduction_ratio": 1 - visual_edges / len(source_edges),
            "canonical_serialized_representation_bytes": len(
                canonical_bytes(serialized_lod)
            ),
            "full_detail_canonical_serialized_representation_bytes": len(
                canonical_bytes(full_payload)
            ),
        },
        "mismatches": mismatches,
    }


def _expected_quotient(
    edges: list[tuple[str, str, str, float | None]], groups: dict[str, str]
) -> tuple[
    set[tuple[str, str]],
    dict[tuple[str, str], list[tuple[str, str, str, float | None]]],
    list[str],
]:
    expected: set[tuple[str, str]] = set()
    support: dict[tuple[str, str], list[tuple[str, str, str, float | None]]] = (
        defaultdict(list)
    )
    unmapped: list[str] = []
    for edge in edges:
        if edge[1] not in groups or edge[2] not in groups:
            unmapped.append(edge[0])
            continue
        group_edge = _edge_pair(groups[edge[1]], groups[edge[2]])
        if group_edge[0] != group_edge[1]:
            expected.add(group_edge)
            support[group_edge].append(edge)
    return expected, support, unmapped


def _edge_pair(source: str, target: str) -> tuple[str, str]:
    return tuple(sorted((source, target)))


def _edge_record(
    edge: tuple[str, str, str, float | None],
) -> tuple[str, str, str, float | None]:
    return edge


def _connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _rows(
    connection: sqlite3.Connection, query: str, params: tuple[str, ...]
) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(query, params).fetchall()]


def _load_positions(
    database: Path, dataset_id: str, layout_id: str
) -> dict[str, tuple[float, float, str, str]]:
    with _connection(database) as connection:
        rows = _rows(
            connection,
            "select node_id, x, y, cluster_id, status from node_positions where dataset_id=? and layout_version=? order by node_id",
            (dataset_id, layout_id),
        )
    return {
        row["node_id"]: (
            float(row["x"]),
            float(row["y"]),
            row["cluster_id"],
            row["status"],
        )
        for row in rows
    }


def _load_memberships(
    database: Path, dataset_id: str, layout_id: str, cluster_ids: list[str]
) -> dict[str, list[str]]:
    result = {cluster_id: [] for cluster_id in cluster_ids}
    if not cluster_ids:
        return result
    marks = ",".join("?" for _ in cluster_ids)
    with _connection(database) as connection:
        rows = connection.execute(
            f"select cluster_id, node_id from cluster_members where dataset_id=? and layout_version=? and cluster_id in ({marks}) order by cluster_id, node_id",
            (dataset_id, layout_id, *cluster_ids),
        ).fetchall()
    for row in rows:
        result[row["cluster_id"]].append(row["node_id"])
    return result


def _representation_payload(view: Any) -> dict[str, Any]:
    return {
        "nodes": [
            (node.node_id, node.cluster_id, node.x, node.y, node.member_count)
            for node in view.nodes
        ],
        "edges": [
            (edge.edge_id, edge.source, edge.target, edge.distance)
            for edge in view.edges
        ],
        "global_bounds": (
            view.global_bounds.min_x,
            view.global_bounds.max_x,
            view.global_bounds.min_y,
            view.global_bounds.max_y,
        ),
    }


def _full_payload(
    node_ids: tuple[str, ...],
    positions: dict[str, tuple[float, float, str, str]],
    edges: list[tuple[str, str, str, float | None]],
    bounds: dict[str, float],
) -> dict[str, Any]:
    return {
        "nodes": [
            (node_id, positions[node_id][0], positions[node_id][1])
            for node_id in node_ids
        ],
        "edges": edges,
        "bounds": bounds,
    }


def _decode_bounds(bounds: dict[str, Any]) -> dict[str, float]:
    return {
        key: float.fromhex(value["float_hex"])
        for key, value in bounds.items()
        if key in {"xmin", "xmax", "ymin", "ymax", "padding"}
    }


def summarize_cases(cases: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "ordered_cases": [
            {
                "case_id": case["case_id"],
                "status": case["status"],
                "level": case["level"],
                "reduction": case["reduction"],
                "membership_valid": not any(case["mismatches"].values()),
            }
            for case in sorted(cases, key=lambda item: item["level"]["lod_level"])
        ],
    }


def _manifest(
    run_id: str,
    config: dict,
    source: dict,
    layout: dict,
    levels: list[int],
    state: str,
    root: Path,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": EXPERIMENT_ID,
        "run_id": run_id,
        "state": state,
        "created_utc": utc_now(),
        "expected_terminal_cases": len(levels),
        "observed_terminal_cases": 0,
        "policy": {
            "retries": 0,
            "browser_sessions": 0,
            "performance_metrics": False,
            "full_world_padding_fraction": config["full_world_padding_fraction"],
            "max_nodes": config["max_nodes"],
        },
        "scientific_question": config["research_question"],
        "product": {
            "version": PRODUCT_RELEASE_VERSION,
            "release_commit": PRODUCT_RELEASE_COMMIT,
            "source_diff_empty": True,
        },
        "source": source_record(source),
        "layout": layout,
        "levels": levels,
        "environment": capture_environment(root),
    }


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
