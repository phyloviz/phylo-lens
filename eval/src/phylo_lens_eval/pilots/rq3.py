"""RQ3 paired ablation of persisted LoD triangles versus reconstructed detail.

No production endpoint is involved: the evaluation reader consumes the same
prepared SQLite artifacts that back viewport reads.  Aggregate membership comes
from ``cluster_members``; coordinates always come from ``node_positions``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
from pathlib import Path
from typing import Any

from phylo_lens_server.domain.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    SourceFormat,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

from .. import SCHEMA_VERSION
from ..core.common import (
    create_isolated_run_directory,
    new_run_id,
    utc_now,
    validate_manifest,
    validate_rq2_observation,
    validate_rq3_pair,
    write_json,
)
from ..core.environment import capture_environment
from .rq2 import _run_repetition, _validate_browser_prerequisites
from ..core.stats import summary

CONDITIONS = ("full_detail", "triangle_aggregation")
GENERATOR_VERSION = "rq3-persisted-layout-v1"


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run paired RQ3 LoD ablations.")
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--results-root", type=Path)
    args = parser.parse_args()
    print(run(args))


def load_experiment(path: Path, experiment_id: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("experiments", [])
    found = [item for item in items if item.get("id") == experiment_id]
    required = {
        "id",
        "research_question",
        "warmup_repetitions",
        "measured_repetitions",
        "timeout_seconds",
        "quiescence_ms",
        "animation_duration_ms",
        "frame_budget_ms",
        "minimum_frame_sample_count",
        "rss_sampling_interval_seconds",
        "browser",
        "input",
        "synthetic_dataset",
        "camera_states",
        "labels_enabled",
    }
    if (
        payload.get("schema_version") != "1"
        or len(found) != 1
        or found[0].get("research_question") != "RQ3"
        or not required <= set(found[0])
    ):
        raise ValueError("Invalid or unknown RQ3 experiment configuration.")
    if not found[0]["camera_states"] or not all(
        state.get("id") for state in found[0]["camera_states"]
    ):
        raise ValueError("RQ3 requires named deterministic camera states.")
    return found[0]


def run(args: argparse.Namespace) -> Path:
    root = repository_root()
    experiment = load_experiment(
        root / "eval/config/rq3-experiments.json", args.experiment
    )
    _validate_browser_prerequisites(root)
    warmups = experiment["warmup_repetitions"] if args.warmups is None else args.warmups
    repetitions = (
        experiment["measured_repetitions"]
        if args.repetitions is None
        else args.repetitions
    )
    if (
        not isinstance(warmups, int)
        or warmups < 0
        or not isinstance(repetitions, int)
        or repetitions < 1
    ):
        raise ValueError("RQ3 repetition counts are invalid.")
    run_dir = create_isolated_run_directory(
        (args.results_root or root / "eval/results/raw").resolve(),
        experiment["id"],
        new_run_id(),
    )
    resolved = {
        **experiment,
        "warmup_repetitions": warmups,
        "measured_repetitions": repetitions,
    }
    manifest = _manifest(
        experiment, run_dir.name, resolved, capture_environment(root), "running"
    )
    validate_manifest(manifest)
    write_json(run_dir / "resolved-config.json", resolved)
    write_json(run_dir / "manifest.json", manifest)
    dataset = synthetic_dataset(experiment["synthetic_dataset"])
    dataset_checksum = checksum(dataset.model_dump(mode="json"))
    pairs: list[dict[str, Any]] = []
    for index in range(warmups + repetitions):
        for camera in experiment["camera_states"]:
            pair = _run_pair(
                root,
                run_dir,
                experiment,
                dataset,
                dataset_checksum,
                camera,
                index,
                index < warmups,
            )
            validate_rq3_pair(pair)
            pairs.append(pair)
            _append_jsonl(run_dir / "pairs.jsonl", pair)
    write_json(run_dir / "summary.json", summarize_pairs(pairs))
    manifest["state"] = (
        "completed"
        if all(pair["semantic_equivalence"]["valid"] for pair in pairs)
        else "failed"
    )
    validate_manifest(manifest)
    write_json(run_dir / "manifest.json", manifest)
    return run_dir


def synthetic_dataset(config: dict[str, Any]) -> CanonicalDataset:
    count, seed = config["node_count"], config["seed"]
    if not isinstance(count, int) or count < 8 or not isinstance(seed, int):
        raise ValueError(
            "RQ3 synthetic dataset requires a deterministic size and seed."
        )
    nodes = [CanonicalNode(id=f"n-{index}") for index in range(count)]
    edges: list[CanonicalEdge] = []
    for index in range(count - 1):
        # Three persisted hierarchy tiers: 240, 150, then one component.
        distance = 0.01 if index < 60 else 0.1 if index < 150 else 10.0
        edges.append(
            CanonicalEdge(
                id=f"e-{index}",
                source=f"n-{index}",
                target=f"n-{index + 1}",
                distance=distance,
            )
        )
    return CanonicalDataset(
        dataset_id=config["id"],
        nodes=nodes,
        edges=edges,
        source=DatasetSource(
            format=SourceFormat.NEWICK,
            generated_at="1970-01-01T00:00:00Z",
            provenance=f"synthetic seed {seed}; not biological data",
        ),
    )


def _run_pair(
    root: Path,
    run_dir: Path,
    experiment: dict,
    dataset: CanonicalDataset,
    dataset_checksum: str,
    camera: dict,
    index: int,
    warmup: bool,
) -> dict:
    pair_dir = (
        run_dir
        / "pairs"
        / camera["id"]
        / f"{'warmup' if warmup else 'measured'}-{index + 1:03d}"
    )
    store = PreparedLayoutStore(pair_dir / "prepared-layout")
    prepared = PreparedLayoutWorker(store).prepare_dataset(dataset)
    request, lod_response, full_response = paired_responses(
        store, prepared.artifacts.layout_version, dataset.dataset_id, camera
    )
    semantic = semantic_equivalence(
        lod_response,
        full_response,
        store.path,
        dataset.dataset_id,
        prepared.artifacts.layout_version,
    )
    pair_id = deterministic_pair_id(
        dataset_checksum,
        prepared.artifacts.layout_version,
        camera["id"],
        experiment["browser"],
        experiment["labels_enabled"],
        index,
        camera_request=request,
        warmup=warmup,
    )
    order = counterbalanced_order(pair_id, index)
    fixture_data = {
        "triangle_aggregation": fixture_config(
            pair_id,
            "triangle_aggregation",
            lod_response,
            dataset_checksum,
            prepared.artifacts.layout_version,
            camera,
            experiment,
        ),
        "full_detail": fixture_config(
            pair_id,
            "full_detail",
            full_response,
            dataset_checksum,
            prepared.artifacts.layout_version,
            camera,
            experiment,
        ),
    }
    write_json(pair_dir / "fixtures.json", fixture_data)
    observations: dict[str, dict] = {}
    for condition in order:
        fixture = fixture_data[condition]
        observation = _run_repetition(
            root,
            pair_dir / "conditions" / condition,
            experiment,
            fixture,
            index,
            warmup,
            float(experiment["timeout_seconds"]),
        )
        validate_rq2_observation(observation)
        observations[condition] = observation
    return build_pair_result(
        pair_id,
        warmup,
        index,
        dataset_checksum,
        prepared.artifacts.layout_version,
        request,
        camera["id"],
        order,
        fixture_data,
        observations,
        semantic,
    )


def paired_responses(
    store: PreparedLayoutStore, layout_version: str, dataset_id: str, camera: dict
) -> tuple[dict, dict, dict]:
    initial = store.read_viewport(
        dataset_id=dataset_id,
        layout_version=layout_version,
        xmin=None,
        xmax=None,
        ymin=None,
        ymax=None,
        max_nodes=100_000,
        lod_level=camera["lod_level"],
    )
    bounds = initial.global_bounds
    if bounds is None:
        raise ValueError("Prepared layout has no coordinate bounds.")
    request = camera_request(camera, bounds)
    view = store.read_viewport(
        dataset_id=dataset_id,
        layout_version=layout_version,
        max_nodes=100_000,
        **request,
    )
    lod = viewport_response(view)
    detail = reconstruct_full_detail(store.path, dataset_id, layout_version, lod)
    return request, lod, detail


def camera_request(camera: dict, bounds: Any) -> dict:
    scale = float(camera["scale"])
    cx = bounds.min_x + (bounds.max_x - bounds.min_x) * float(
        camera["center_x_fraction"]
    )
    cy = bounds.min_y + (bounds.max_y - bounds.min_y) * float(
        camera["center_y_fraction"]
    )
    half_x, half_y = (
        (bounds.max_x - bounds.min_x) * scale / 2,
        (bounds.max_y - bounds.min_y) * scale / 2,
    )
    return {
        "xmin": cx - half_x,
        "xmax": cx + half_x,
        "ymin": cy - half_y,
        "ymax": cy + half_y,
        "lod_level": camera["lod_level"],
    }


def viewport_response(view: Any) -> dict:
    return {
        "nodes": [
            {
                "id": node.node_id,
                "cluster_id": node.cluster_id,
                "x": node.x,
                "y": node.y,
                "layout_status": node.layout_status,
                "member_count": node.member_count,
                "is_representative": node.is_representative,
                "metadata": {"is_cluster_proxy": node.member_count > 1},
            }
            for node in view.nodes
        ],
        "edges": [
            {
                "id": edge.edge_id,
                "source": edge.source,
                "target": edge.target,
                "distance": edge.distance,
            }
            for edge in view.edges
        ],
        "global_bounds": {
            "min_x": view.global_bounds.min_x,
            "max_x": view.global_bounds.max_x,
            "min_y": view.global_bounds.min_y,
            "max_y": view.global_bounds.max_y,
        },
    }


def reconstruct_full_detail(
    database_path: Path, dataset_id: str, layout_version: str, aggregate_response: dict
) -> dict:
    """Expand selected persisted clusters through cluster_members, never geometry."""
    aggregate_nodes = [
        node for node in aggregate_response["nodes"] if node["member_count"] > 1
    ]
    explicit_node_ids = {
        node["id"] for node in aggregate_response["nodes"] if node["member_count"] == 1
    }
    cluster_ids = [node["cluster_id"] for node in aggregate_nodes]
    if len(cluster_ids) != len(set(cluster_ids)):
        raise ValueError("Aggregate expansion failure: duplicate visible aggregate id.")
    if not cluster_ids and not explicit_node_ids:
        raise ValueError("Aggregate viewport has no selected clusters.")
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        member_ids = persisted_members(
            connection, dataset_id, layout_version, aggregate_nodes
        )
        full_ids = explicit_node_ids | member_ids
        if explicit_node_ids & member_ids:
            raise ValueError("Aggregate expansion failure: explicit/member overlap.")
        marks = ",".join("?" for _ in full_ids)
        members = connection.execute(
            f"select np.node_id, np.cluster_id, np.x, np.y, np.status from node_positions np where np.dataset_id=? and np.layout_version=? and np.node_id in ({marks}) order by np.node_id",
            (dataset_id, layout_version, *sorted(full_ids)),
        ).fetchall()
        if {row["node_id"] for row in members} != full_ids:
            raise ValueError(
                "Aggregate expansion failure: persisted node position missing."
            )
        edges = connection.execute(
            f"select edge_id, source_node_id, target_node_id, distance from graph_edges where dataset_id=? and layout_version=? and source_node_id in ({marks}) and target_node_id in ({marks}) order by edge_id",
            (dataset_id, layout_version, *sorted(full_ids), *sorted(full_ids)),
        ).fetchall()
    edge_ids = [edge["edge_id"] for edge in edges]
    if len(edge_ids) != len(set(edge_ids)):
        raise ValueError("Full-detail reconstruction has duplicate edge identity.")
    if any(
        edge["source_node_id"] == edge["target_node_id"]
        or edge["source_node_id"] not in full_ids
        or edge["target_node_id"] not in full_ids
        for edge in edges
    ):
        raise ValueError("Full-detail reconstruction has invalid topology endpoint.")
    return {
        "nodes": [
            {
                "id": row["node_id"],
                "cluster_id": row["cluster_id"],
                "x": row["x"],
                "y": row["y"],
                "layout_status": row["status"],
                "member_count": 1,
                "is_representative": False,
                "metadata": {},
            }
            for row in members
        ],
        "edges": [
            {
                "id": row["edge_id"],
                "source": row["source_node_id"],
                "target": row["target_node_id"],
                "distance": row["distance"],
            }
            for row in edges
        ],
        "global_bounds": aggregate_response["global_bounds"],
    }


def persisted_members(
    connection: sqlite3.Connection,
    dataset_id: str,
    layout_version: str,
    aggregate_nodes: list[dict],
) -> set[str]:
    aggregate_ids = [node["cluster_id"] for node in aggregate_nodes]
    if not aggregate_ids:
        return set()
    marks = ",".join("?" for _ in aggregate_ids)
    rows = connection.execute(
        f"select cluster_id, node_id from cluster_members where dataset_id=? and layout_version=? and cluster_id in ({marks}) order by cluster_id, node_id",
        (dataset_id, layout_version, *aggregate_ids),
    ).fetchall()
    by_cluster: dict[str, set[str]] = {
        cluster_id: set() for cluster_id in aggregate_ids
    }
    for row in rows:
        if row["node_id"] in by_cluster[row["cluster_id"]]:
            raise ValueError(
                "Aggregate expansion failure: duplicate persisted member id."
            )
        by_cluster[row["cluster_id"]].add(row["node_id"])
    seen: set[str] = set()
    for aggregate in aggregate_nodes:
        members = by_cluster[aggregate["cluster_id"]]
        if len(members) != aggregate["member_count"]:
            raise ValueError("Aggregate expansion failure: member_count mismatch.")
        if seen & members:
            raise ValueError(
                "Aggregate expansion failure: overlapping aggregate membership."
            )
        seen.update(members)
    return seen


def semantic_equivalence(
    lod: dict,
    detail: dict,
    database_path: Path | None = None,
    dataset_id: str | None = None,
    layout_version: str | None = None,
) -> dict:
    try:
        explicit = {node["id"] for node in lod["nodes"] if node["member_count"] == 1}
        aggregates = [node for node in lod["nodes"] if node["member_count"] > 1]
        if len(explicit) + len(aggregates) != len(lod["nodes"]):
            raise ValueError("duplicate_explicit_node_id")
        if database_path is None or dataset_id is None or layout_version is None:
            aggregate_members = set().union(*({node["id"]} for node in aggregates))
        else:
            with sqlite3.connect(database_path) as connection:
                connection.row_factory = sqlite3.Row
                aggregate_members = persisted_members(
                    connection, dataset_id, layout_version, aggregates
                )
        if explicit & aggregate_members:
            raise ValueError("explicit_node_member_overlap")
        triangle_ids = explicit | aggregate_members
        detail_ids = [node["id"] for node in detail["nodes"]]
        if len(detail_ids) != len(set(detail_ids)):
            raise ValueError("duplicate_full_detail_member_id")
        full_set = set(detail_ids)
        valid = triangle_ids == full_set
        reason = None if valid else "semantic_id_set_mismatch"
    except ValueError as error:
        triangle_ids, full_set, valid, reason = set(), set(), False, str(error)
        explicit, aggregate_members = set(), set()
    return {
        "valid": valid,
        "triangle_represented_population": len(triangle_ids),
        "full_detail_represented_population": len(full_set),
        "reason": reason,
        "triangle_explicit_node_ids": sorted(explicit),
        "triangle_aggregate_member_ids": sorted(aggregate_members),
        "full_detail_node_ids": sorted(full_set),
    }


def fixture_config(
    pair_id: str,
    condition: str,
    response: dict,
    dataset_checksum: str,
    layout_id: str,
    camera: dict,
    experiment: dict,
) -> dict:
    triangles = sum(node["member_count"] > 1 for node in response["nodes"])
    payload = payload_bytes(response)
    return {
        "id": f"{pair_id}-{condition}",
        "seed": int(experiment["synthetic_dataset"]["seed"]),
        "labels_enabled": experiment["labels_enabled"],
        "generator_version": GENERATOR_VERSION,
        "node_count": len(response["nodes"]),
        "edge_count": len(response["edges"]),
        "triangle_count": triangles,
        "response": response,
        "pair_id": pair_id,
        "condition": condition,
        "dataset_checksum_sha256": dataset_checksum,
        "prepared_layout_id": layout_id,
        "camera_state_id": camera["id"],
        "represented_population": sum(
            node["member_count"] for node in response["nodes"]
        ),
        "payload_bytes_uncompressed": payload,
    }


def build_pair_result(
    pair_id: str,
    warmup: bool,
    index: int,
    dataset_checksum: str,
    layout_id: str,
    request: dict,
    camera_id: str,
    order: tuple[str, str],
    fixtures: dict,
    observations: dict,
    semantic: dict,
) -> dict:
    full, lod = fixtures["full_detail"], fixtures["triangle_aggregation"]
    representation = {
        "node_difference": full["node_count"] - lod["node_count"],
        "edge_difference": full["edge_count"] - lod["edge_count"],
        "triangle_difference": full["triangle_count"] - lod["triangle_count"],
        "primitive_difference": full["node_count"]
        + full["edge_count"]
        + full["triangle_count"]
        - lod["node_count"]
        - lod["edge_count"]
        - lod["triangle_count"],
        "primitive_reduction_ratio": ratio_metric(
            full["node_count"] + full["edge_count"] + full["triangle_count"],
            lod["node_count"] + lod["edge_count"] + lod["triangle_count"],
        ),
        "payload_byte_difference": full["payload_bytes_uncompressed"]
        - lod["payload_bytes_uncompressed"],
        "payload_reduction_ratio": ratio_metric(
            full["payload_bytes_uncompressed"], lod["payload_bytes_uncompressed"]
        ),
    }
    invalid = [] if semantic["valid"] else [semantic["reason"]]
    metrics = paired_metrics(observations)
    for group in metrics.values():
        for metric in group.values():
            if metric["state"] == "unavailable" and metric["reason"] not in invalid:
                invalid.append(metric["reason"])
    browser = observations["full_detail"]["browser"]
    if (
        observations["triangle_aggregation"]["browser"]["version"] != browser["version"]
        or observations["triangle_aggregation"]["browser"]["headless"]
        != browser["headless"]
    ):
        invalid.append("incompatible_browser_identity")
    return {
        "schema_version": SCHEMA_VERSION,
        "pair_id": pair_id,
        "warmup": warmup,
        "repetition_index": index,
        "source": {
            "dataset_checksum_sha256": dataset_checksum,
            "prepared_layout_id": layout_id,
            "viewport": browser["viewport"],
            "device_scale_factor": browser["device_scale_factor"],
            "labels_enabled": full["labels_enabled"],
            "browser_version": browser["version"],
            "headless": browser["headless"],
            "api_contract_version": "1",
        },
        "camera_state": {"id": camera_id, "request": request},
        "execution_order": list(order),
        "conditions": {
            condition: {
                "observation_path": observations[condition]["artifacts"][
                    "browser_result"
                ].replace("browser-result.json", "observation.json"),
                "status": observations[condition]["status"],
                "fixture": {
                    "checksum_sha256": observations[condition]["fixture"][
                        "checksum_sha256"
                    ],
                    **{
                        key: fixtures[condition][key]
                        for key in (
                            "node_count",
                            "edge_count",
                            "triangle_count",
                            "represented_population",
                            "payload_bytes_uncompressed",
                        )
                    },
                    "total_primitive_count": fixtures[condition]["node_count"]
                    + fixtures[condition]["edge_count"]
                    + fixtures[condition]["triangle_count"],
                },
            }
            for condition in CONDITIONS
        },
        "semantic_equivalence": semantic,
        "representation": representation,
        "metrics": metrics,
        "invalid_reasons": invalid,
    }


def ratio_metric(full: float, lod: float) -> dict:
    if not math.isfinite(full) or not math.isfinite(lod):
        return {"state": "unavailable", "value": None, "reason": "non_finite_metric"}
    if full < 0 or lod < 0:
        return {
            "state": "unavailable",
            "value": None,
            "reason": "negative_denominator_or_value",
        }
    return (
        {"state": "unavailable", "value": None, "reason": "zero_denominator"}
        if full == 0
        else {"state": "available", "value": 1 - lod / full, "reason": None}
    )


def paired_metrics(observations: dict) -> dict:
    full, lod = observations["full_detail"], observations["triangle_aggregation"]

    incompatible_browser = (
        full["browser"]["version"] != lod["browser"]["version"]
        or full["browser"]["headless"] != lod["browser"]["headless"]
    )

    def difference(
        path: tuple[str, ...], ratio: bool = False, require_tree: bool = False
    ) -> dict:
        if full["status"] != "success" or lod["status"] != "success":
            return unavailable("browser_failure")
        if incompatible_browser:
            return unavailable("incompatible_browser_identity")
        if require_tree and (
            full["rss"]["scope"] != "process_tree"
            or lod["rss"]["scope"] != "process_tree"
        ):
            return unavailable("incompatible_memory_scope")
        a, b = value_at(full, path), value_at(lod, path)
        if a is None or b is None:
            return unavailable("unsupported_metric")
        return ratio_metric(a, b) if ratio else available(a - b)

    return {
        "latency": {
            "absolute_difference_ms": difference(
                ("timing", "load_to_post_update_frame_ms")
            ),
            "render_speedup": speedup(full, lod),
        },
        "heap": {
            "js_heap_used_difference_bytes": difference(
                ("heap", "delta", "js_heap_used_bytes", "bytes")
            ),
            "js_heap_used_reduction_ratio": difference(
                ("heap", "delta", "js_heap_used_bytes", "bytes"), True
            ),
        },
        "rss": {
            "absolute_difference_bytes": difference(
                ("rss", "peak_delta_bytes"), require_tree=True
            ),
            "reduction_ratio": difference(("rss", "peak_delta_bytes"), True, True),
        },
        "frame": {
            "median_difference_ms": difference(("frame_statistics", "median_ms")),
            "p95_difference_ms": difference(("frame_statistics", "p95_ms")),
            "maximum_difference_ms": difference(("frame_statistics", "maximum_ms")),
            "long_frame_proportion_difference": difference(
                ("frame_statistics", "above_33_3_ms_proportion")
            ),
        },
    }


def speedup(full: dict, lod: dict) -> dict:
    if full["status"] != "success" or lod["status"] != "success":
        return unavailable("browser_failure")
    if (
        full["browser"]["version"] != lod["browser"]["version"]
        or full["browser"]["headless"] != lod["browser"]["headless"]
    ):
        return unavailable("incompatible_browser_identity")
    numerator, denominator = (
        value_at(full, ("timing", "load_to_post_update_frame_ms")),
        value_at(lod, ("timing", "load_to_post_update_frame_ms")),
    )
    if numerator is None or denominator is None:
        return unavailable("unsupported_metric")
    return (
        unavailable("zero_denominator")
        if denominator == 0
        else available(numerator / denominator)
    )


def available(value: float) -> dict:
    if not math.isfinite(value):
        return unavailable("non_finite_metric")
    return {"state": "available", "value": value, "reason": None}


def unavailable(reason: str) -> dict:
    return {"state": "unavailable", "value": None, "reason": reason}


def value_at(item: dict, path: tuple[str, ...]) -> float | int | None:
    item = _at(item, path)
    return (
        item if isinstance(item, (int, float)) and not isinstance(item, bool) else None
    )


def _at(item: dict, path: tuple[str, ...]) -> Any:
    for key in path:
        item = item.get(key, {}) if isinstance(item, dict) else {}
    return item


def payload_bytes(response: dict) -> int:
    return len(json.dumps(response, sort_keys=True, separators=(",", ":")).encode())


def checksum(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def deterministic_pair_id(
    dataset_checksum: str,
    layout_id: str,
    camera_id: str,
    browser: dict,
    labels: bool,
    index: int,
    *,
    camera_request: dict | None = None,
    warmup: bool = False,
) -> str:
    return (
        "rq3-"
        + checksum(
            {
                "dataset": dataset_checksum,
                "layout": layout_id,
                "camera": camera_id,
                "camera_request": camera_request,
                "viewport": browser["viewport"],
                "scale": browser["device_scale_factor"],
                "labels": labels,
                "repetition": index,
                "warmup": warmup,
                "api_contract_version": "1",
            }
        )[:16]
    )


def counterbalanced_order(pair_id: str, index: int) -> tuple[str, str]:
    return (
        CONDITIONS
        if (int(pair_id[-1], 16) + index) % 2 == 0
        else tuple(reversed(CONDITIONS))
    )


def _append_jsonl(path: Path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(payload, sort_keys=True) + "\n")


def summarize_pairs(pairs: list[dict]) -> dict:
    measured = [pair for pair in pairs if not pair["warmup"]]
    valid = [pair for pair in measured if pair["semantic_equivalence"]["valid"]]
    values = [
        pair["representation"]["primitive_reduction_ratio"]["value"]
        for pair in valid
        if pair["representation"]["primitive_reduction_ratio"]["state"] == "available"
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "configured_pair_count": len(measured),
        "valid_semantic_pair_count": sum(
            pair["semantic_equivalence"]["valid"] for pair in measured
        ),
        "invalid_semantic_pair_count": sum(
            not pair["semantic_equivalence"]["valid"] for pair in measured
        ),
        "primitive_reduction_ratio": summary(values),
        "paired_metrics": {
            name: metric_summary(valid, path)
            for name, path in {
                "representation.primitive_reduction_ratio": (
                    "representation",
                    "primitive_reduction_ratio",
                ),
                "representation.payload_reduction_ratio": (
                    "representation",
                    "payload_reduction_ratio",
                ),
                "latency.absolute_difference_ms": (
                    "metrics",
                    "latency",
                    "absolute_difference_ms",
                ),
                "latency.render_speedup": (
                    "metrics",
                    "latency",
                    "render_speedup",
                ),
                "heap.js_heap_used_difference_bytes": (
                    "metrics",
                    "heap",
                    "js_heap_used_difference_bytes",
                ),
                "rss.absolute_difference_bytes": (
                    "metrics",
                    "rss",
                    "absolute_difference_bytes",
                ),
                "frame.median_difference_ms": (
                    "metrics",
                    "frame",
                    "median_difference_ms",
                ),
                "frame.p95_difference_ms": (
                    "metrics",
                    "frame",
                    "p95_difference_ms",
                ),
            }.items()
        },
        "pairs": [
            {"pair_id": pair["pair_id"], "metrics": pair["metrics"]}
            for pair in measured
        ],
    }


def metric_summary(pairs: list[dict], path: tuple[str, ...]) -> dict:
    metrics = [_at(pair, path) for pair in pairs]
    available_values = [
        metric["value"]
        for metric in metrics
        if isinstance(metric, dict) and metric.get("state") == "available"
    ]
    return {
        "count": len(pairs),
        "valid_pair_count": len(available_values),
        "invalid_pair_count": len(pairs) - len(available_values),
        "distribution": summary(available_values),
    }


def _manifest(
    experiment: dict, run_id: str, resolved: dict, environment: dict, state: str
) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "experiment_id": experiment["id"],
        "run_id": run_id,
        "timestamp_utc": utc_now(),
        "git": environment["git"],
        "environment": {
            key: value for key, value in environment.items() if key != "git"
        },
        "dataset": {"id": experiment["synthetic_dataset"]["id"]},
        "parameters": {
            "experiment_id": experiment["id"],
            "dataset_ids": [experiment["synthetic_dataset"]["id"]],
            "warmup_repetitions": resolved["warmup_repetitions"],
            "measured_repetitions": resolved["measured_repetitions"],
            "timeout_seconds": resolved["timeout_seconds"],
            "persistence_backend": "sqlite",
        },
        "state": state,
    }


if __name__ == "__main__":
    main()
