"""Filesystem, checksum, failure, and schema helpers shared by evaluation commands."""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psutil

SQLITE_ARTIFACT_FILENAMES = (
    "prepared_layout.sqlite3",
    "prepared_layout.sqlite3-shm",
    "prepared_layout.sqlite3-wal",
)
RSS_SAMPLE_INTERVAL_SECONDS = 0.02


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def new_run_id() -> str:
    return f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:10]}"


def checksum_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def persisted_size_bytes(root: Path) -> int:
    """Return only the SQLite database and transient WAL/SHM sidecars."""
    return sum(
        (root / filename).stat().st_size
        for filename in SQLITE_ARTIFACT_FILENAMES
        if (root / filename).is_file()
    )


def create_isolated_run_directory(
    results_root: Path, experiment_id: str, run_id: str
) -> Path:
    run_dir = results_root / experiment_id / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def wait_with_peak_rss(
    process: subprocess.Popen, timeout: float
) -> tuple[int, bool, str]:
    """Wait for a child, sampling live process-tree RSS at a fixed interval."""
    deadline, peak_rss, timed_out = time.monotonic() + timeout, 0, False
    scope = "sampled_process_tree"
    root_process = psutil.Process(process.pid)
    while process.poll() is None:
        try:
            related = [root_process, *root_process.children(recursive=True)]
            live_rss = sum(
                item.memory_info().rss for item in related if item.is_running()
            )
            peak_rss = max(peak_rss, live_rss)
        except (psutil.Error, PermissionError, ValueError):
            scope = "sampled_root_process"
            try:
                peak_rss = max(peak_rss, root_process.memory_info().rss)
            except (psutil.Error, PermissionError):
                pass
        if time.monotonic() >= deadline:
            timed_out = True
            terminate_process_tree(process)
            break
        time.sleep(RSS_SAMPLE_INTERVAL_SECONDS)
    process.wait()
    return peak_rss, timed_out, scope


def terminate_process_tree(process: subprocess.Popen) -> None:
    if os.name != "nt":
        os.killpg(process.pid, signal.SIGKILL)
    else:  # pragma: no cover - Windows fallback
        process.kill()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def validate_manifest(payload: dict) -> None:
    _validate_schema(payload, "manifest.schema.json")


def validate_observation(payload: dict) -> None:
    _validate_schema(payload, "observation.schema.json")


def classify_failure(returncode: int | None, timed_out: bool) -> str:
    if timed_out:
        return "timeout"
    if returncode is None:
        return "runtime_error"
    if returncode < 0 and -returncode == signal.SIGKILL:
        return "oom"
    return "runtime_error"


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value)


def _validate_schema(payload: dict, filename: str) -> None:
    from jsonschema import Draft202012Validator, FormatChecker

    schema_path = Path(__file__).resolve().parents[2] / "schemas/v1" / filename
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(payload), key=lambda error: list(error.path))
    if errors:
        raise ValueError(errors[0].message)
