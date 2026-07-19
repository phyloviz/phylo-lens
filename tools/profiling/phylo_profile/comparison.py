from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import json
from pathlib import Path
import statistics
from typing import Any, Iterable


@dataclass(frozen=True)
class Aggregate:
    key: tuple[Any, ...]
    count: int
    median_ms: float
    mean_ms: float
    min_ms: float
    max_ms: float


def load_stage_durations(path: Path) -> dict[tuple[Any, ...], list[float]]:
    grouped: dict[tuple[Any, ...], list[float]] = defaultdict(list)
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get("event") != "stage":
                continue
            key = (
                event.get("shape"),
                event.get("target_nodes"),
                event.get("stage"),
                event.get("lod_level"),
                event.get("bounds_fraction"),
                event.get("max_nodes"),
            )
            grouped[key].append(float(event["duration_ms"]))
    return grouped


def aggregate(
    grouped: dict[tuple[Any, ...], list[float]],
) -> dict[tuple[Any, ...], Aggregate]:
    return {
        key: Aggregate(
            key=key,
            count=len(values),
            median_ms=statistics.median(values),
            mean_ms=statistics.fmean(values),
            min_ms=min(values),
            max_ms=max(values),
        )
        for key, values in grouped.items()
    }


def comparison_rows(
    baseline: dict[tuple[Any, ...], Aggregate],
    current: dict[tuple[Any, ...], Aggregate],
) -> Iterable[tuple[tuple[Any, ...], Aggregate | None, Aggregate | None, float | None]]:
    for key in sorted(set(baseline) | set(current)):
        before = baseline.get(key)
        after = current.get(key)
        ratio = None
        if before is not None and after is not None and before.median_ms > 0:
            ratio = after.median_ms / before.median_ms
        yield key, before, after, ratio


def format_key(key: tuple[Any, ...]) -> str:
    shape, target_nodes, stage, lod_level, bounds_fraction, max_nodes = key
    parts = [str(shape), f"n={target_nodes}", str(stage)]
    if lod_level is not None:
        parts.append(f"lod={lod_level}")
    if bounds_fraction is not None:
        parts.append(f"bounds={bounds_fraction}")
    if max_nodes is not None:
        parts.append(f"max={max_nodes}")
    return " ".join(parts)

