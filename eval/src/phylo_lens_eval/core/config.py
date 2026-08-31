"""Declarative evaluation configuration validation and path resolution."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ALLOWED_FORMATS = {"newick", "typing_data"}
ALLOWED_TOPOLOGIES = {
    "balanced",
    "caterpillar/highly unbalanced",
    "irregular synthetic",
    "real phylogenetic tree",
    "typing-derived MST/goeBURST structure",
}


class ConfigurationError(ValueError):
    """Raised before an evaluation starts when declared input is invalid."""


@dataclass(frozen=True)
class DatasetConfig:
    id: str
    path: Path
    format: str
    topology: str
    declared_node_count: int | None
    declared_edge_count: int | None
    description: str


@dataclass(frozen=True)
class ExperimentConfig:
    id: str
    research_question: str
    pipeline: str
    dataset_ids: tuple[str, ...]
    warmup_repetitions: int
    measured_repetitions: int
    timeout_seconds: float
    persistence_backend: str


def _read_catalog(path: Path, key: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ConfigurationError(
            f"Configuration file does not exist: {path}"
        ) from error
    except json.JSONDecodeError as error:
        raise ConfigurationError(f"Invalid JSON in {path}: {error.msg}") from error
    if payload.get("schema_version") != "1" or not isinstance(payload.get(key), list):
        raise ConfigurationError(
            f"{path} must declare schema_version '1' and a '{key}' list."
        )
    return payload[key]


def load_datasets(path: Path, repository_root: Path) -> dict[str, DatasetConfig]:
    datasets: dict[str, DatasetConfig] = {}
    for item in _read_catalog(path, "datasets"):
        dataset_id = _nonempty(item, "id", path)
        if dataset_id in datasets:
            raise ConfigurationError(f"Duplicate dataset id '{dataset_id}'.")
        format_name = _nonempty(item, "format", path)
        topology = _nonempty(item, "topology", path)
        if format_name not in ALLOWED_FORMATS:
            raise ConfigurationError(
                f"Dataset '{dataset_id}' has unsupported format '{format_name}'."
            )
        if topology not in ALLOWED_TOPOLOGIES:
            raise ConfigurationError(
                f"Dataset '{dataset_id}' has unsupported topology '{topology}'."
            )
        relative_path = Path(_nonempty(item, "path", path))
        if relative_path.is_absolute():
            raise ConfigurationError(
                f"Dataset '{dataset_id}' path must be repository-relative."
            )
        input_path = (repository_root / relative_path).resolve()
        if not input_path.is_file():
            raise ConfigurationError(
                f"Dataset '{dataset_id}' path does not exist: {input_path}"
            )
        datasets[dataset_id] = DatasetConfig(
            id=dataset_id,
            path=input_path,
            format=format_name,
            topology=topology,
            declared_node_count=_optional_positive_int(
                item, "declared_node_count", dataset_id
            ),
            declared_edge_count=_optional_nonnegative_int(
                item, "declared_edge_count", dataset_id
            ),
            description=str(item.get("description", "")),
        )
    return datasets


def load_experiments(path: Path) -> dict[str, ExperimentConfig]:
    experiments: dict[str, ExperimentConfig] = {}
    for item in _read_catalog(path, "experiments"):
        experiment_id = _nonempty(item, "id", path)
        if experiment_id in experiments:
            raise ConfigurationError(f"Duplicate experiment id '{experiment_id}'.")
        dataset_ids = item.get("dataset_ids")
        if (
            not isinstance(dataset_ids, list)
            or not dataset_ids
            or not all(isinstance(v, str) and v for v in dataset_ids)
        ):
            raise ConfigurationError(
                f"Experiment '{experiment_id}' needs a non-empty dataset_ids list."
            )
        warmups = _positive_or_zero_int(item, "warmup_repetitions", experiment_id)
        repetitions = _positive_int(item, "measured_repetitions", experiment_id)
        timeout = item.get("timeout_seconds")
        if (
            not isinstance(timeout, (int, float))
            or isinstance(timeout, bool)
            or timeout <= 0
        ):
            raise ConfigurationError(
                f"Experiment '{experiment_id}' timeout_seconds must be greater than zero."
            )
        backend = _nonempty(item, "persistence_backend", path)
        if backend != "sqlite":
            raise ConfigurationError(
                f"Experiment '{experiment_id}' only supports sqlite persistence in phase one."
            )
        experiments[experiment_id] = ExperimentConfig(
            id=experiment_id,
            research_question=_nonempty(item, "research_question", path),
            pipeline=_nonempty(item, "pipeline", path),
            dataset_ids=tuple(dataset_ids),
            warmup_repetitions=warmups,
            measured_repetitions=repetitions,
            timeout_seconds=float(timeout),
            persistence_backend=backend,
        )
    return experiments


def resolve_experiment(
    experiment_id: str,
    experiments: dict[str, ExperimentConfig],
    datasets: dict[str, DatasetConfig],
) -> ExperimentConfig:
    try:
        experiment = experiments[experiment_id]
    except KeyError as error:
        raise ConfigurationError(f"Unknown experiment id '{experiment_id}'.") from error
    unknown = sorted(set(experiment.dataset_ids) - set(datasets))
    if unknown:
        raise ConfigurationError(
            f"Experiment '{experiment_id}' references unknown datasets: {', '.join(unknown)}."
        )
    if experiment.pipeline != "direct-tree":
        raise ConfigurationError(
            f"Experiment '{experiment_id}' is not a direct-tree RQ1 experiment."
        )
    return experiment


def _nonempty(item: dict[str, Any], key: str, path: Path) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"{path}: '{key}' must be a non-empty string.")
    return value


def _optional_positive_int(
    item: dict[str, Any], key: str, identifier: str
) -> int | None:
    if key not in item:
        return None
    return _positive_int(item, key, identifier)


def _optional_nonnegative_int(
    item: dict[str, Any], key: str, identifier: str
) -> int | None:
    if key not in item:
        return None
    value = item[key]
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ConfigurationError(
            f"Dataset '{identifier}' {key} must be a non-negative integer."
        )
    return value


def _positive_int(item: dict[str, Any], key: str, identifier: str) -> int:
    value = item.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ConfigurationError(
            f"Experiment '{identifier}' {key} must be a positive integer."
        )
    return value


def _positive_or_zero_int(item: dict[str, Any], key: str, identifier: str) -> int:
    value = item.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ConfigurationError(
            f"Experiment '{identifier}' {key} must be a non-negative integer."
        )
    return value
