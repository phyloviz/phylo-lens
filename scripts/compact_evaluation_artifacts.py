"""Losslessly compact historical generated SQLite files, retaining measured-000.

Timing observations, logs and samples are never candidates. gzip verification
compares the decompressed SHA-256 before removing an original. Restore any file
with gzip -dk PATH.gz. Use --apply to execute the printed plan.
"""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path


def digest(stream):
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
        h.update(block)
    return h.hexdigest()


def compact(path):
    output = path.with_name(path.name + ".gz")
    temporary = output.with_name(output.name + ".partial")
    if output.exists() or temporary.exists():
        raise FileExistsError(output)
    with path.open("rb") as source:
        original_hash = digest(source)
    with path.open("rb") as source, temporary.open("xb") as target:
        with gzip.GzipFile(
            filename="", fileobj=target, mode="wb", compresslevel=1, mtime=0
        ) as archive:
            for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
                archive.write(block)
        target.flush()
        os.fsync(target.fileno())
    with gzip.open(temporary, "rb") as restored:
        if digest(restored) != original_hash:
            raise ValueError("Archive integrity mismatch: " + str(path))
    record = {
        "original": str(path),
        "original_sha256": original_hash,
        "original_bytes": path.stat().st_size,
        "archive": str(output),
        "archive_bytes": temporary.stat().st_size,
    }
    temporary.rename(output)
    path.unlink()
    return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run", type=Path)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--inventory", type=Path, required=True)
    args = p.parse_args()
    candidates = sorted(
        path
        for path in args.run.resolve().glob(
            "conditions/*/*/persistence/prepared_layout/prepared_layout.sqlite3*"
        )
        if path.is_file()
        and path.name
        in {
            "prepared_layout.sqlite3",
            "prepared_layout.sqlite3-wal",
            "prepared_layout.sqlite3-shm",
        }
        and not any(part.startswith("measured-000-") for part in path.parts)
    )
    print(
        json.dumps(
            {
                "files": len(candidates),
                "bytes": sum(p.stat().st_size for p in candidates),
                "apply": args.apply,
            }
        ),
        flush=True,
    )
    if not args.apply:
        return
    args.inventory.parent.mkdir(parents=True, exist_ok=True)
    with args.inventory.open("a") as inventory:
        for path in candidates:
            record = compact(path)
            inventory.write(json.dumps(record) + "\n")
            inventory.flush()
            print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
