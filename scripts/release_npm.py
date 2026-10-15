"""Publish only the tested tarball; accept retries only for byte-identical packages."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from release_version import parse_version

PACKAGE = "@phyloviz/phylo-lens"
REGISTRY = "https://registry.npmjs.org"


def get_json(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise  # Authentication, rate limiting and outages are never 'not published'.


def package_info(tarball: Path, version: str) -> str:
    parse_version(version)
    with tarfile.open(tarball) as archive:
        manifest = archive.extractfile("package/package.json")
        if manifest is None:
            raise ValueError("Tarball has no package manifest")
        package = json.load(manifest)
    if package.get("name") != PACKAGE or package.get("version") != version:
        raise ValueError("Tarball name/version does not match the requested release")
    return (
        "sha512-"
        + base64.b64encode(hashlib.sha512(tarball.read_bytes()).digest()).decode()
    )


def verify(version: str, integrity: str) -> bool:
    metadata = get_json(f"{REGISTRY}/@phyloviz%2fphylo-lens/{version}")
    if metadata is None:
        return False
    if metadata.get("dist", {}).get("integrity") != integrity:
        raise ValueError(
            f"{PACKAGE}@{version} exists with different bytes; never overwrite a release"
        )
    return True


def require_latest(version: str) -> None:
    metadata = get_json(f"{REGISTRY}/@phyloviz%2fphylo-lens/latest")
    if metadata is not None and parse_version(metadata["version"]) > parse_version(
        version
    ):
        raise ValueError(
            "A newer npm version is already latest; refusing to move release aliases backwards"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("publish", "verify", "latest"))
    parser.add_argument("version")
    parser.add_argument("tarball", type=Path, nargs="?")
    args = parser.parse_args()
    parse_version(args.version)
    if args.command == "latest":
        require_latest(args.version)
        return
    if args.tarball is None:
        parser.error("tarball is required")
    integrity = package_info(args.tarball, args.version)
    if args.command == "publish" and not verify(args.version, integrity):
        require_latest(args.version)
        subprocess.run(
            [
                "npm",
                "publish",
                str(args.tarball.resolve()),
                "--ignore-scripts",
                "--access",
                "public",
                "--provenance",
                "--registry",
                REGISTRY,
            ],
            check=True,
        )
    for attempt in range(6):
        if verify(args.version, integrity):
            print(f"Verified {PACKAGE}@{args.version}: {integrity}")
            return
        if attempt < 5:
            time.sleep(5)
    raise SystemExit(
        "Published package is not visible; retry the failed job after checking npm status"
    )


if __name__ == "__main__":
    main()
