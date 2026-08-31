"""Final RQ1 runner using only the released public OCI service path.

The legacy :mod:`phylo_lens_eval.rq1` source-import runner remains intact for
historical pilots.  This module is deliberately separate: every final
observation starts a fresh pinned service container, uses ``/api/graph/prepare``
and its public status endpoint, and retains all terminal evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from ...core.common import utc_now, write_json
from ...core.stats import summary

CONFIG_NAME = "rq1-final-oci-v020.json"
APPROVED_RUN_ID_PATTERN = re.compile(r"thesis-final-rq1-v020-[0-9]{3}")


class FinalRQ1Error(RuntimeError):
    pass


def _validate_run_id(run_id: str) -> None:
    if not APPROVED_RUN_ID_PATTERN.fullmatch(run_id):
        raise FinalRQ1Error(
            "Final RQ1 run ID must match thesis-final-rq1-v020-[0-9]{3}."
        )


def repository_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_config(root: Path | None = None) -> dict[str, Any]:
    root = root or repository_root()
    config = _json(root / "eval/config" / CONFIG_NAME)
    required = {
        "schema_version",
        "id",
        "research_question",
        "classification",
        "product",
        "input_source",
        "warmup_repetitions",
        "measured_repetitions",
        "preparation_timeout_seconds",
        "startup_timeout_seconds",
        "outer_watchdog_seconds",
        "poll_interval_ms",
        "rss_sampling_interval_ms",
        "conditions",
    }
    if set(config) != required or config["classification"] != "final":
        raise FinalRQ1Error(
            "Final RQ1 configuration is not the reviewed closed contract."
        )
    if (
        config["warmup_repetitions"] != 1
        or config["measured_repetitions"] != 5
        or len(config["conditions"]) != 15
    ):
        raise FinalRQ1Error(
            "Final RQ1 configuration must declare 15 conditions with 1 warm-up and 5 measurements."
        )
    if (
        config["preparation_timeout_seconds"] != 300
        or config["startup_timeout_seconds"] <= 0
        or config["outer_watchdog_seconds"] < 330
    ):
        raise FinalRQ1Error("Final RQ1 timeout contract is invalid.")
    if config["poll_interval_ms"] <= 0 or config["rss_sampling_interval_ms"] != 20:
        raise FinalRQ1Error("Final RQ1 polling or RSS sampling cadence is invalid.")
    expected = {
        (leaves, topology)
        for leaves in (5000, 10000, 25000, 50000, 100000)
        for topology in ("balanced", "irregular", "caterpillar")
    }
    actual = {
        (item["requested_leaves"], item["topology"]) for item in config["conditions"]
    }
    if actual != expected or len({item["id"] for item in config["conditions"]}) != 15:
        raise FinalRQ1Error(
            "Final RQ1 conditions do not exactly match the approved matrix."
        )
    if config["product"] != {
        "release_tag": "v0.2.0",
        "release_commit": "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9",
        "oci_index_reference": "ghcr.io/phyloviz/phylo-lens-service@sha256:3031f36bbf661d03a9c8843279ab8342f7931770d1c631ca88e3127670d14525",
        "npm_companion_version": "@phyloviz/phylo-lens@0.2.0",
    }:
        raise FinalRQ1Error(
            "Final RQ1 released product provenance is not the approved closed contract."
        )
    return config


def condition_path(
    root: Path, config: dict[str, Any], condition: dict[str, Any]
) -> Path:
    raw = Path(condition["path"])
    if raw.parts and raw.parts[0].startswith("pilot-synthetic-"):
        return root / config["input_source"]["relative_root"] / raw
    return (root / raw).resolve()


def verified_conditions(root: Path, config: dict[str, Any]) -> list[dict[str, Any]]:
    verified = []
    for condition in config["conditions"]:
        path = condition_path(root, config, condition)
        if not path.is_file():
            raise FinalRQ1Error(f"Retained final input is unavailable: {path}")
        actual = _sha256(path)
        if actual != condition["sha256"]:
            raise FinalRQ1Error(
                f"Retained final input checksum differs for {condition['id']}: {actual}"
            )
        verified.append(
            {**condition, "absolute_path": str(path), "byte_size": path.stat().st_size}
        )
    return verified


def _command(*args: str, timeout: float | None = None) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            args, text=True, capture_output=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"returncode": None, "stdout": "", "stderr": str(error)}
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def _git(root: Path, *args: str) -> str:
    result = _command("git", "-C", str(root), *args, timeout=10)
    if result["returncode"] != 0:
        raise FinalRQ1Error(f"git {' '.join(args)} failed: {result['stderr']}")
    return result["stdout"].strip()


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _request(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: float = 5,
) -> tuple[int, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"raw": raw}


def _safe_name(value: str) -> str:
    return (
        "rq1-final-" + "".join(char if char.isalnum() else "-" for char in value)[:55]
    )


def _container_identity(image: str, name: str) -> dict[str, Any]:
    inspection = _command("docker", "inspect", name, timeout=15)
    image_inspection = _command("docker", "image", "inspect", image, timeout=15)
    manifest = _command("docker", "manifest", "inspect", "--verbose", image, timeout=30)
    result: dict[str, Any] = {
        "image_reference": image,
        "container_inspect": None,
        "image_inspect": None,
        "platform_manifest_digest": None,
    }
    if inspection["returncode"] == 0:
        result["container_inspect"] = json.loads(inspection["stdout"])[0]
    if image_inspection["returncode"] == 0:
        result["image_inspect"] = json.loads(image_inspection["stdout"])[0]
    if manifest["returncode"] == 0:
        try:
            payload = json.loads(manifest["stdout"])
            architecture = (
                result["image_inspect"].get("Architecture")
                if result["image_inspect"]
                else None
            )
            os_name = (
                result["image_inspect"].get("Os") if result["image_inspect"] else None
            )
            entries = (
                payload.get("manifests", [])
                if isinstance(payload, dict)
                else payload
                if isinstance(payload, list)
                else []
            )
            for entry in entries:
                descriptor = (
                    entry.get("Descriptor", {}) if isinstance(entry, dict) else {}
                )
                candidate = entry.get("platform", descriptor.get("platform", {}))
                if (
                    candidate.get("architecture") == architecture
                    and candidate.get("os") == os_name
                ):
                    result["platform_manifest_digest"] = entry.get(
                        "digest", descriptor.get("digest")
                    )
                    break
            result["manifest_inspect"] = payload
            result["runtime_platform"] = f"{os_name}/{architecture}"
        except json.JSONDecodeError:
            result["manifest_inspect_error"] = manifest["stdout"]
    return result


def _health(base_url: str, deadline: float) -> dict[str, Any]:
    latest: Any = None
    while time.monotonic() < deadline:
        try:
            status, body = _request(f"{base_url}/health")
            latest = {"status": status, "body": body}
            if 200 <= status < 300:
                return latest
        except Exception as error:  # public endpoint may not be ready yet
            latest = {"error": f"{type(error).__name__}: {error}"}
        time.sleep(0.15)
    raise FinalRQ1Error(f"Service health startup bound elapsed: {latest}")


def _graphviz_gts_smoke(service_name: str) -> dict[str, Any]:
    """Exercise sfdp in the released image before t0; this is never timed."""
    command = _command(
        # ``sh -l`` resets PATH in this minimal image.  Plain ``sh -c``
        # preserves the image's declared PATH, which contains the released
        # Graphviz and GTS runtime used by the service itself.
        "docker",
        "exec",
        service_name,
        "sh",
        "-c",
        "sfdp -V 2>&1; printf 'graph { a -- b; }\\n' | sfdp -Tplain",
        timeout=15,
    )
    evidence = {
        "command": "sfdp -V; minimal undirected sfdp plain-layout smoke",
        "returncode": command["returncode"],
        "stdout": command["stdout"],
        "stderr": command["stderr"],
        "gts_capability_smoke": command["returncode"] == 0
        and "graph" in command["stdout"],
    }
    if not evidence["gts_capability_smoke"]:
        raise FinalRQ1Error(
            "Released OCI image did not pass the Graphviz/GTS sfdp smoke."
        )
    return evidence


def _stop_container(name: str) -> None:
    if name:
        _command("docker", "rm", "--force", name, timeout=30)


def _start_sampler(
    image: str,
    service_name: str,
    sampler_name: str,
    output_dir: Path,
    config: dict[str, Any],
) -> None:
    script = Path(__file__).with_name("rq1_rss_sidecar.py")
    result = _command(
        "docker",
        "run",
        "--detach",
        "--name",
        sampler_name,
        "--pid",
        f"container:{service_name}",
        "--network",
        "none",
        "--mount",
        f"type=bind,source={script},target=/sampler.py,readonly",
        "--mount",
        f"type=bind,source={output_dir},target=/out",
        "--entrypoint",
        "python",
        image,
        "/sampler.py",
        "--output",
        "/out/rss.jsonl",
        "--metadata",
        "/out/rss-metadata.json",
        "--interval-seconds",
        str(config["rss_sampling_interval_ms"] / 1000),
        timeout=30,
    )
    if result["returncode"] != 0:
        raise FinalRQ1Error(
            f"Could not start PID-namespace RSS sidecar: {result['stderr'] or result['stdout']}"
        )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if (output_dir / "rss.jsonl").is_file():
            return
        time.sleep(0.02)
    raise FinalRQ1Error("RSS sidecar did not emit a raw sample before t0.")


def _run_observation(
    root: Path,
    run_dir: Path,
    config: dict[str, Any],
    condition: dict[str, Any],
    phase: str,
    repetition: int,
) -> dict[str, Any]:
    observation_id = f"{phase}-{repetition:03d}-{condition['id']}"
    directory = run_dir / "conditions" / condition["id"] / observation_id
    directory.mkdir(parents=True)
    persistence = directory / "persistence"
    persistence.mkdir()
    port = _free_port()
    service_name, sampler_name = (
        _safe_name(observation_id),
        _safe_name("sampler-" + observation_id),
    )
    image = config["product"]["oci_index_reference"]
    request_payload = {
        "format": "newick",
        "dataset_name": condition["id"],
        "content": Path(condition["absolute_path"]).read_text(encoding="utf-8"),
    }
    write_json(directory / "request.json", request_payload)
    started = time.monotonic()
    service_started = False
    sampler_started = False
    terminal_payload: Any = None
    status_payloads: list[dict[str, Any]] = []
    result: dict[str, Any] = {
        "schema_version": "2",
        "observation_id": observation_id,
        "condition_id": condition["id"],
        "requested_leaves": condition["requested_leaves"],
        "parsed_nodes": condition["parsed_nodes"],
        "parsed_edges": condition["parsed_edges"],
        "topology": condition["topology"],
        "seed": condition["seed"],
        "input_sha256": condition["sha256"],
        "phase": phase,
        "repetition_index": repetition,
        "status": "failure",
        "failure_kind": "runtime_error",
        "timing": {
            "t0_monotonic_ns": None,
            "t_ready_observed_monotonic_ns": None,
            "preparation_wall_ms": None,
            "poll_interval_ms": config["poll_interval_ms"],
        },
        "layout_status": None,
        "memory": {
            "scope": "unavailable",
            "peak_rss_bytes": None,
            "sample_count": 0,
            "sfdp_observed": False,
        },
        "terminal": None,
        "oci_runtime": None,
        "error": None,
    }
    try:
        command = _command(
            "docker",
            "run",
            "--detach",
            "--name",
            service_name,
            "--publish",
            f"127.0.0.1:{port}:8000",
            "--env",
            "PHYLO_LENS_DATA_DIR=/data",
            "--mount",
            f"type=bind,source={persistence},target=/data",
            image,
            timeout=config["startup_timeout_seconds"],
        )
        if command["returncode"] != 0:
            raise FinalRQ1Error(
                f"Pinned service container failed to start: {command['stderr'] or command['stdout']}"
            )
        service_started = True
        base_url = f"http://127.0.0.1:{port}"
        result["health"] = _health(
            base_url, time.monotonic() + config["startup_timeout_seconds"]
        )
        result["graphviz"] = _graphviz_gts_smoke(service_name)
        result["oci_runtime"] = _container_identity(image, service_name)
        _start_sampler(image, service_name, sampler_name, directory, config)
        sampler_started = True
        t0 = time.monotonic_ns()
        result["timing"]["t0_monotonic_ns"] = t0
        status, terminal_payload = _request(
            f"{base_url}/api/graph/prepare",
            method="POST",
            payload=request_payload,
            timeout=10,
        )
        write_json(
            directory / "prepare-response.json",
            {"status": status, "body": terminal_payload},
        )
        if (
            status != 202
            or not isinstance(terminal_payload, dict)
            or not isinstance(terminal_payload.get("job_id"), str)
        ):
            result.update(
                status="failure",
                failure_kind="submission_failure",
                error=f"Public prepare submission returned HTTP {status}",
            )
        else:
            job_id = terminal_payload["job_id"]
            deadline = time.monotonic() + config["preparation_timeout_seconds"]
            outer_deadline = started + config["outer_watchdog_seconds"]
            while True:
                now = time.monotonic()
                if now >= deadline:
                    result.update(
                        status="timeout",
                        failure_kind="preparation_timeout",
                        error="Preparation observation exceeded 300 seconds.",
                    )
                    break
                if now >= outer_deadline:
                    result.update(
                        status="timeout",
                        failure_kind="outer_watchdog_timeout",
                        error="Outer safety watchdog elapsed after the preparation deadline headroom.",
                    )
                    break
                poll_status, poll_body = _request(
                    f"{base_url}/api/graph/prepare/{job_id}", timeout=10
                )
                record = {
                    "monotonic_ns": time.monotonic_ns(),
                    "http_status": poll_status,
                    "body": poll_body,
                }
                status_payloads.append(record)
                if (
                    poll_status == 200
                    and isinstance(poll_body, dict)
                    and poll_body.get("status") == "ready"
                ):
                    ready = record["monotonic_ns"]
                    layout_status = poll_body.get("result", {}).get("layout_status")
                    result["timing"]["t_ready_observed_monotonic_ns"] = ready
                    result["timing"]["preparation_wall_ms"] = (ready - t0) / 1_000_000
                    result["layout_status"] = layout_status
                    if layout_status != "ready":
                        result.update(
                            status="invalid",
                            failure_kind="degraded_or_non_sfdp_layout",
                            error="Non-trivial final RQ1 preparation did not report ready sfdp layout.",
                        )
                    else:
                        result.update(status="success", failure_kind="none")
                    terminal_payload = poll_body
                    break
                if (
                    poll_status == 200
                    and isinstance(poll_body, dict)
                    and poll_body.get("status") == "failed"
                ):
                    result.update(
                        status="failure",
                        failure_kind="preparation_failure",
                        error=str(poll_body.get("error")),
                    )
                    terminal_payload = poll_body
                    break
                time.sleep(config["poll_interval_ms"] / 1000)
    except Exception as error:
        result.update(
            status="failure",
            failure_kind="runtime_error",
            error=f"{type(error).__name__}: {error}",
        )
    finally:
        write_json(directory / "status-polls.json", status_payloads)
        if sampler_started:
            _command("docker", "stop", "--time", "5", sampler_name, timeout=15)
        _stop_container(sampler_name)
        if service_started:
            logs = _command("docker", "logs", service_name, timeout=30)
            (directory / "service.log").write_text(
                logs["stdout"] + logs["stderr"], encoding="utf-8"
            )
        _stop_container(service_name)
        metadata_path = directory / "rss-metadata.json"
        if metadata_path.is_file():
            memory_metadata = _json(metadata_path)
            samples = [
                _json_line(line)
                for line in (directory / "rss.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line
            ]
            valid = memory_metadata.get("sampling_scope") == "process_tree" and all(
                sample.get("scope") == "process_tree" for sample in samples
            )
            result["memory"] = {
                "scope": "process_tree" if valid else "unavailable",
                "peak_rss_bytes": max(
                    (sample.get("rss_bytes", 0) for sample in samples), default=None
                )
                if valid
                else None,
                "sample_count": memory_metadata.get("sample_count", 0),
                "sfdp_observed": bool(memory_metadata.get("sfdp_observed")),
            }
        result["terminal"] = terminal_payload
        result["persistence_artifact_bytes"] = sum(
            item.stat().st_size for item in persistence.rglob("*") if item.is_file()
        )
        write_json(directory / "observation.json", result)
    return result


def _json_line(line: str) -> dict[str, Any]:
    return json.loads(line)


def preflight(root: Path, config: dict[str, Any], thesis_root: Path) -> dict[str, Any]:
    conditions = verified_conditions(root, config)
    product_commit = config["product"]["release_commit"]
    product_diff = _git(
        root,
        "diff",
        "--binary",
        f"{product_commit}..HEAD",
        "--",
        "code/server",
        "code/client",
    )
    state = {
        "product_release_commit": product_commit,
        "product_release_tag": config["product"]["release_tag"],
        "oci_index_reference": config["product"]["oci_index_reference"],
        "npm_companion_version": config["product"]["npm_companion_version"],
        "evaluation_harness_commit": _git(root, "rev-parse", "HEAD"),
        "evaluation_harness_dirty": bool(
            _git(root, "status", "--porcelain", "--untracked-files=all")
        ),
        "thesis_repository_commit": _git(thesis_root, "rev-parse", "HEAD"),
        "thesis_repository_dirty": bool(
            _git(thesis_root, "status", "--porcelain", "--untracked-files=all")
        ),
        "product_source_diff_empty": product_diff == "",
        "verified_conditions": conditions,
        "host": {
            "os": os.uname().sysname,
            "release": os.uname().release,
            "machine": os.uname().machine,
            "logical_cpu_count": os.cpu_count(),
            "physical_memory_bytes": _physical_memory_bytes(),
        },
        "docker_version": _command(
            "docker", "version", "--format", "{{json .}}", timeout=15
        ),
    }
    if (
        state["evaluation_harness_dirty"]
        or state["thesis_repository_dirty"]
        or not state["product_source_diff_empty"]
    ):
        raise FinalRQ1Error(
            "Final RQ1 preflight requires clean worktrees and no product-source difference from v0.2.0."
        )
    if state["thesis_repository_commit"] != "5cfd264eee0bcb54f03ae27488ec9ddf4d5b2d75":
        raise FinalRQ1Error(
            "Thesis repository commit is not the approved final provenance commit."
        )
    return state


def _physical_memory_bytes() -> int | None:
    """Best-effort host RAM provenance without treating it as a measurement."""
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (AttributeError, OSError, ValueError):
        return None


def run(args: argparse.Namespace) -> Path:
    root = repository_root()
    config = load_config(root)
    _validate_run_id(args.run_id)
    thesis_root = (args.thesis_root or root.parent / "Thesis").resolve()
    state = preflight(root, config, thesis_root)
    run_dir = (
        (args.results_root or root / "eval/results/raw").resolve()
        / config["id"]
        / args.run_id
    )
    if run_dir.exists():
        raise FinalRQ1Error(
            f"Immutable final RQ1 run directory already exists: {run_dir}"
        )
    run_dir.mkdir(parents=True)
    resolved = {
        key: config[key]
        for key in (
            "id",
            "warmup_repetitions",
            "measured_repetitions",
            "startup_timeout_seconds",
            "preparation_timeout_seconds",
            "outer_watchdog_seconds",
            "poll_interval_ms",
            "rss_sampling_interval_ms",
            "product",
        )
    }
    write_json(run_dir / "resolved-config.json", resolved)
    write_json(
        run_dir / "manifest.json",
        {
            "schema_version": "2",
            "run_id": args.run_id,
            "state": "running",
            "created_utc": utc_now(),
            "provenance": state,
            "expected_raw_observations": 90,
        },
    )
    observations: list[dict[str, Any]] = []
    for condition in state["verified_conditions"]:
        for phase, count in (("warmup", 1), ("measured", 5)):
            for index in range(count):
                observation = _run_observation(
                    root, run_dir, config, condition, phase, index
                )
                observations.append(observation)
                with (run_dir / "observations.jsonl").open(
                    "a", encoding="utf-8"
                ) as stream:
                    stream.write(json.dumps(observation, sort_keys=True) + "\n")
    write_json(run_dir / "summary.json", raw_summary(observations))
    write_json(
        run_dir / "manifest.json",
        {
            "schema_version": "2",
            "run_id": args.run_id,
            "state": "completed",
            "created_utc": utc_now(),
            "provenance": state,
            "expected_raw_observations": 90,
        },
    )
    return run_dir


def raw_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups = []
    for condition_id in sorted({row["condition_id"] for row in rows}):
        items = [row for row in rows if row["condition_id"] == condition_id]
        measured = [row for row in items if row["phase"] == "measured"]
        successful = [row for row in measured if row["status"] == "success"]
        tree_memory = [
            row["memory"]["peak_rss_bytes"]
            for row in successful
            if row["memory"]["scope"] == "process_tree"
            and isinstance(row["memory"]["peak_rss_bytes"], int)
        ]
        groups.append(
            {
                "condition_id": condition_id,
                "requested_leaves": items[0]["requested_leaves"],
                "parsed_nodes": items[0]["parsed_nodes"],
                "parsed_edges": items[0]["parsed_edges"],
                "topology": items[0]["topology"],
                "seed": items[0]["seed"],
                "input_sha256": items[0]["input_sha256"],
                "warmup_count": len(items) - len(measured),
                "measured_count": len(measured),
                "success_count": len(successful),
                "failure_count": sum(row["status"] == "failure" for row in measured),
                "timeout_count": sum(row["status"] == "timeout" for row in measured),
                "invalid_count": sum(row["status"] == "invalid" for row in measured),
                "preparation_wall_ms": summary(
                    [
                        float(row["timing"]["preparation_wall_ms"])
                        for row in successful
                        if row["timing"]["preparation_wall_ms"] is not None
                    ]
                ),
                "process_tree_peak_rss_bytes": summary(
                    [float(value) for value in tree_memory]
                ),
                "memory_unavailable_count": len(successful) - len(tree_memory),
            }
        )
    return {"schema_version": "2", "groups": groups}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the final OCI-backed PhyloLens RQ1 matrix."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--results-root", type=Path)
    parser.add_argument("--thesis-root", type=Path)
    args = parser.parse_args()
    try:
        print(run(args))
    except FinalRQ1Error as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
