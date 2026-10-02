"""Plan or export the explicitly selected thesis evidence; never upload it."""

import argparse
import fnmatch
import hashlib
import io
import json
import shutil
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def selected_files(root, plan, thesis):
    files = {}
    excluded = set(plan["excluded_directory_names"])
    excluded_files = plan.get("excluded_filename_patterns", [])
    for relative in plan["paths"]:
        source = root / relative
        if not source.exists():
            raise ValueError(f"Missing selected evidence: {relative}")
        candidates = source.rglob("*") if source.is_dir() else [source]
        for path in candidates:
            rel = path.relative_to(root)
            if (
                path.is_symlink()
                or excluded.intersection(rel.parts)
                or any(
                    fnmatch.fnmatch(path.name, pattern) for pattern in excluded_files
                )
            ):
                continue
            if path.is_file():
                files[rel.as_posix()] = path
    registry = json.loads((root / plan["input_registry"]).read_text())
    for condition in registry["conditions"]:
        path = thesis / "data/salmonella/fullmst" / condition["path"]
        if not path.is_file():
            raise ValueError(f"Missing retained input: {path}")
        files[f"inputs/fullmst/{condition['path']}"] = path
    return dict(sorted(files.items())), registry


def require_audited_rq1(root, plan):
    run = root / plan["rq1_run"]
    manifest = json.loads((run / "manifest.json").read_text())
    if manifest.get("state") != "completed":
        raise ValueError(
            "RQ1 is incomplete: export is deferred to avoid benchmark contention."
        )
    audit_path = run / "audit.json"
    if (
        not audit_path.exists()
        or json.loads(audit_path.read_text()).get("passed") is not True
    ):
        raise ValueError("RQ1 must pass audit_preparation_evaluation.py before export.")


def export(root, plan, files, registry, output):
    require_audited_rq1(root, plan)
    if output.exists():
        raise ValueError(f"Refusing to overwrite {output}")
    if not output.parent.is_dir():
        raise ValueError("Output parent must already exist.")
    for name in files:
        if output.is_relative_to(root / name):
            raise ValueError("Output cannot overwrite selected evidence.")
    total = sum(path.stat().st_size for path in files.values())
    if shutil.disk_usage(output.parent).free < total + 512 * 1024**2:
        raise ValueError(
            "Insufficient space for a conservative uncompressed-size archive bound."
        )
    expected = {
        f"inputs/fullmst/{c['path']}": c["sha256"] for c in registry["conditions"]
    }
    inventory = {}
    for name, path in files.items():
        sha = digest(path)
        if name in expected and sha != expected[name]:
            raise ValueError(f"Retained input hash mismatch: {name}")
        inventory[name] = {
            "sha256": sha,
            "bytes": path.stat().st_size,
            "original_absolute": str(path),
        }
    metadata = json.dumps(
        {
            "plan": plan,
            "files": inventory,
            "original_repository_root": str(root),
            "inputs_verified": True,
        },
        indent=2,
    ).encode()
    temporary = output.with_name(output.name + ".partial")
    if temporary.exists():
        raise ValueError(f"Remove or inspect previous incomplete export: {temporary}")
    try:
        with tarfile.open(temporary, "w:gz") as archive:
            for name, path in files.items():
                archive.add(path, arcname=name, recursive=False)
            info = tarfile.TarInfo("BUNDLE_MANIFEST.json")
            info.size = len(metadata)
            archive.addfile(info, io.BytesIO(metadata))
        # Re-read the archive, checking file hashes rather than only gzip integrity.
        with tarfile.open(temporary, "r:gz") as archive:
            for member in archive:
                if member.name == "BUNDLE_MANIFEST.json":
                    continue
                stream = archive.extractfile(member)
                if (
                    stream is None
                    or hashlib.file_digest(stream, "sha256").hexdigest()
                    != inventory[member.name]["sha256"]
                ):
                    raise ValueError(f"Archive content mismatch: {member.name}")
        temporary.rename(output)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return {"archive": str(output), "sha256": digest(output), "files": len(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thesis-root", type=Path)
    parser.add_argument(
        "--output", type=Path, help="Omit to preview without hashing/compression."
    )
    args = parser.parse_args()
    plan = json.loads((ROOT / "eval/publication.json").read_text())
    thesis = (args.thesis_root or ROOT / plan["thesis_root_default"]).resolve()
    try:
        # Check completion before reading large evidence or writing an archive.
        if args.output:
            require_audited_rq1(ROOT, plan)
        files, registry = selected_files(ROOT, plan, thesis)
        result = (
            export(ROOT, plan, files, registry, args.output.resolve())
            if args.output
            else {
                "preview_only": True,
                "files": len(files),
                "selected_bytes": sum(p.stat().st_size for p in files.values()),
                "selected_roots": plan["paths"],
                "rq1_export_gate": "completed campaign and passed independent audit required",
            }
        )
        print(json.dumps(result, indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
