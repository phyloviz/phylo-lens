from __future__ import annotations

import json
from typing import Any


def result_to_json_bytes(value: Any) -> bytes:
    return json.dumps(value, default=profile_json_default, separators=(",", ":")).encode(
        "utf-8"
    )


def profile_json_default(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {
            field: getattr(value, field)
            for field in value.__dataclass_fields__  # type: ignore[attr-defined]
        }
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")

