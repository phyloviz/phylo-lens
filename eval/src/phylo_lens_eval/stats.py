"""Statistics derived solely from successful, measured raw observations."""

from __future__ import annotations

from math import floor
from typing import Iterable


def summarize_observations(observations: Iterable[dict]) -> dict:
    rows = list(observations)
    measured = [row for row in rows if not row.get("warmup", False)]
    successful = [row for row in measured if row.get("state") == "success"]
    metrics = sorted(
        {
            key
            for row in successful
            for key, value in row.items()
            if (key.endswith("_seconds") or key.endswith("_bytes"))
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        }
    )
    stage_names = sorted(
        {
            name
            for row in successful
            for name, value in row.get("stage_durations_seconds", {}).items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
    )
    return {
        "count": len(measured),
        "successful_count": len(successful),
        "failed_count": len(measured) - len(successful),
        "metrics": {
            metric: summary(
                [
                    float(row[metric])
                    for row in successful
                    if isinstance(row.get(metric), (int, float))
                ]
            )
            for metric in metrics
        },
        "stage_durations_seconds": {
            name: summary(
                [
                    float(row["stage_durations_seconds"][name])
                    for row in successful
                    if isinstance(
                        row.get("stage_durations_seconds", {}).get(name), (int, float)
                    )
                ]
            )
            for name in stage_names
        },
    }


def summary(values: list[float]) -> dict | None:
    if not values:
        return None
    ordered = sorted(values)
    p25 = percentile(ordered, 0.25)
    p75 = percentile(ordered, 0.75)
    return {
        "count": len(ordered),
        "median": percentile(ordered, 0.5),
        "p25": p25,
        "p75": p75,
        "iqr": p75 - p25,
        "minimum": ordered[0],
        "maximum": ordered[-1],
    }


def percentile(ordered_values: list[float], proportion: float) -> float:
    if not ordered_values:
        raise ValueError("Cannot calculate a percentile of an empty sample.")
    position = (len(ordered_values) - 1) * proportion
    lower = floor(position)
    upper = min(lower + 1, len(ordered_values) - 1)
    return ordered_values[lower] + (ordered_values[upper] - ordered_values[lower]) * (
        position - lower
    )
