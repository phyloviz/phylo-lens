from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
import json
from pathlib import Path
import time
import tracemalloc
from typing import Any, Iterator


class JsonlSink:
    def __init__(self, output: Path | None) -> None:
        self.output = output
        self._handle = None
        if output is not None:
            output.parent.mkdir(parents=True, exist_ok=True)
            self._handle = output.open("a", encoding="utf-8")

    def write(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, sort_keys=True, separators=(",", ":"))
        if self._handle is None:
            print(line)
            return
        self._handle.write(line + "\n")
        self._handle.flush()

    def close(self) -> None:
        if self._handle is not None:
            self._handle.close()


class NullSink:
    def write(self, event: dict[str, Any]) -> None:
        del event

    def close(self) -> None:
        pass


class MetricRecorder:
    def __init__(self, sink: JsonlSink, base: dict[str, Any]) -> None:
        self.sink = sink
        self.base = base

    def emit(self, event: str, **fields: Any) -> None:
        self.sink.write(
            {
                **self.base,
                "timestamp_utc": datetime.now(UTC).isoformat(),
                "event": event,
                **fields,
            }
        )

    @contextmanager
    def stage(self, name: str, **fields: Any) -> Iterator[None]:
        start_time = time.perf_counter()
        _start_current, start_peak = tracemalloc.get_traced_memory()
        try:
            yield
        finally:
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            _current, peak = tracemalloc.get_traced_memory()
            self.emit(
                "stage",
                stage=name,
                duration_ms=round(duration_ms, 3),
                peak_kib_delta=round((peak - start_peak) / 1024.0, 3),
                **fields,
            )
