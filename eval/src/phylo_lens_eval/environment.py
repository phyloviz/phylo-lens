"""Capture execution environment metadata without making tools mandatory."""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

import psutil


def capture_environment(repository_root: Path) -> dict:
    return {
        "operating_system": platform.platform(),
        "cpu_model": platform.processor() or platform.machine(),
        "logical_cpu_count": os.cpu_count(),
        "total_ram_bytes": psutil.virtual_memory().total,
        "python_version": sys.version,
        "java_version": _tool_version(["java", "-version"]),
        "graphviz_version": _tool_version(["sfdp", "-V"]),
        "docker_version": _tool_version(["docker", "--version"]),
        "git": _git_state(repository_root),
        "phylolens": _phylolens_versions(),
    }


def _tool_version(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            command, text=True, capture_output=True, timeout=10, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = (completed.stdout or completed.stderr).strip()
    return value or None


def _git_state(repository_root: Path) -> dict:
    def git(*args: str) -> str | None:
        try:
            completed = subprocess.run(
                ["git", *args],
                cwd=repository_root,
                text=True,
                capture_output=True,
                timeout=10,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return None
        return completed.stdout.strip() or None

    commit = git("rev-parse", "HEAD")
    return {
        "available": commit is not None,
        "commit": commit,
        "dirty": bool(git("status", "--porcelain")),
    }


def _phylolens_versions() -> dict:
    from phylo_lens_server.utils.versions import API_VERSION, service_version

    return {"api_contract_version": API_VERSION, "server_version": service_version()}
