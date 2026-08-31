"""PID-namespace RSS sampler for the OCI-backed final RQ1 protocol.

This program is bind-mounted into a separate container sharing the service
container's PID namespace.  It deliberately uses only /proc, so it does not
alter the released service image or require a sampler dependency in it.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import time
from pathlib import Path


running = True


def _stop(*_args) -> None:
    global running
    running = False


def _stat(pid: int) -> tuple[int, str] | None:
    try:
        fields = (Path("/proc") / str(pid) / "stat").read_text().split()
        return int(fields[3]), fields[1].strip("()")
    except (FileNotFoundError, IndexError, ValueError, PermissionError):
        return None


def _rss_bytes(pid: int) -> int:
    try:
        for line in (Path("/proc") / str(pid) / "status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (FileNotFoundError, ValueError, PermissionError):
        pass
    return 0


def _snapshot(own_pid: int) -> dict:
    records = {
        pid: value
        for pid in (
            int(item.name) for item in Path("/proc").iterdir() if item.name.isdigit()
        )
        if (value := _stat(pid))
    }
    children: dict[int, list[int]] = {}
    for pid, (parent, _name) in records.items():
        children.setdefault(parent, []).append(pid)
    excluded = {own_pid}
    pending = [own_pid]
    while pending:
        pending.extend(children.get(pending.pop(), []))
        excluded.update(pending)
    service = (
        1
        if 1 in records and 1 not in excluded
        else min((pid for pid in records if pid not in excluded), default=None)
    )
    members: list[dict] = []
    if service is not None:
        pending = [service]
        seen: set[int] = set()
        while pending:
            pid = pending.pop()
            if pid in seen or pid in excluded or pid not in records:
                continue
            seen.add(pid)
            parent, name = records[pid]
            members.append(
                {"pid": pid, "ppid": parent, "comm": name, "rss_bytes": _rss_bytes(pid)}
            )
            pending.extend(children.get(pid, []))
    return {
        "monotonic_ns": time.monotonic_ns(),
        "scope": "process_tree" if service is not None else "unavailable",
        "service_pid": service,
        "members": members,
        "rss_bytes": sum(member["rss_bytes"] for member in members),
        "sfdp_present": any(member["comm"] == "sfdp" for member in members),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--interval-seconds", type=float, required=True)
    args = parser.parse_args()
    if args.interval_seconds <= 0:
        raise SystemExit("sampling interval must be positive")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    own_pid, samples, saw_sfdp = os.getpid(), 0, False
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        while running:
            sample = _snapshot(own_pid)
            saw_sfdp = saw_sfdp or sample["sfdp_present"]
            stream.write(json.dumps(sample, sort_keys=True) + "\n")
            stream.flush()
            samples += 1
            time.sleep(args.interval_seconds)
    args.metadata.write_text(
        json.dumps(
            {
                "sampling_scope": "process_tree",
                "sample_count": samples,
                "sfdp_observed": saw_sfdp,
                "sampler_pid": own_pid,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
