"""Shared current-source provenance and local server lifecycle for evaluations."""

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone

from run_local_rq34 import ROOT, file_hash, free_port


def source_hashes(product):
    paths = [
        p
        for folder in ("code/client/src", "code/server/src", "code/server/sql")
        for p in (product / folder).rglob("*")
        if p.is_file() and "__pycache__" not in p.parts
    ]
    paths += [
        product / p
        for p in (
            "code/client/package.json",
            "code/client/package-lock.json",
            "code/server/pyproject.toml",
        )
        if (product / p).exists()
    ]
    return {str(p.relative_to(product)): file_hash(p) for p in sorted(paths)}


def provenance(product):
    hashes = source_hashes(product)
    displays = subprocess.run(
        ["rtk", "proxy", "system_profiler", "-json", "SPDisplaysDataType"],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    return {
        "product_root": str(product),
        "product_commit": subprocess.check_output(
            ["rtk", "proxy", "git", "rev-parse", "HEAD"], cwd=product, text=True
        ).strip(),
        "product_source_sha256": hashes,
        "product_fingerprint": hashlib.sha256(
            json.dumps(hashes, sort_keys=True).encode()
        ).hexdigest(),
        "package_version": json.loads(
            (product / "code/client/package.json").read_text()
        )["version"],
        "published_release": False,
        "host": {
            "platform": platform.platform(),
            "logical_cpu_count": os.cpu_count(),
            "memory_bytes": int(
                subprocess.check_output(
                    ["rtk", "proxy", "sysctl", "-n", "hw.memsize"], text=True
                ).strip()
            ),
            "cpu": subprocess.check_output(
                ["rtk", "proxy", "sysctl", "-n", "machdep.cpu.brand_string"], text=True
            ).strip(),
        },
        "python": sys.version,
        "graphviz": subprocess.run(
            ["rtk", "proxy", "sfdp", "-V"], text=True, capture_output=True, check=True
        ).stderr.strip(),
        "refresh_rate": "physical display refresh rate not explicitly controlled; display metadata retained where exposed by macOS",
        "display_metadata": json.loads(displays.stdout)
        if displays.returncode == 0 and displays.stdout.strip()
        else {"unavailable": displays.stderr},
        "created_utc": datetime.now(timezone.utc).isoformat(),
    }


def snapshot(product, directory):
    result = provenance(product)
    directory.mkdir(parents=True, exist_ok=True)
    for rel in result["product_source_sha256"]:
        target = directory / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(product / rel, target)
    return result


def request(url, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


@contextmanager
def server(product, directory, layout_dir=None):
    port = free_port()
    layout = (layout_dir or directory / "persistence").resolve()
    layout.mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "PYTHONPATH": str(product / "code/server/src")
        + os.pathsep
        + str(ROOT / "eval/scripts"),
        "PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR": str(layout),
        "PHYLO_LENS_PREPARE_JOB_BACKEND": "local",
        "PHYLO_LENS_CORS_ORIGINS": "*",
        "PHYLO_LENS_EVAL_PROFILE": str(
            (directory / "preparation-profile.jsonl").resolve()
        ),
    }
    with (directory / "server.log").open("w") as log:
        child = subprocess.Popen(
            [
                "rtk",
                "proxy",
                sys.executable,
                "-m",
                "uvicorn",
                "local_eval_server:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=product,
            env=env,
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 30
            url = f"http://127.0.0.1:{port}"
            while True:
                try:
                    request(url + "/health", timeout=1)
                    break
                except (OSError, TimeoutError):
                    if child.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError(
                            "Server startup failed: " + str(directory / "server.log")
                        )
                    time.sleep(0.2)
            yield url, child, layout
        finally:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
