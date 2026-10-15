"""Push saved, smoke-tested Docker images and verify immutable release identities."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from release_version import parse_version

IMAGE = "ghcr.io/phyloviz/phylo-lens-service"
ARCHITECTURES = ("amd64", "arm64")


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def manifest(ref: str) -> dict | None:
    result = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", "--raw", ref],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        # Fail closed for auth, rate limits, network errors and all unknown errors.
        error = result.stderr.lower()
        if (
            "manifest unknown" in error
            or "manifest_unknown" in error
            or error.strip()
            in {f"error: {ref.lower()}: not found", f"{ref.lower()}: not found"}
        ):
            return None
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)


def verify_index(index: dict, expected: dict[str, str]) -> None:
    entries = index.get("manifests", [])
    actual = {}
    for entry in entries:
        platform = entry.get("platform", {})
        arch = platform.get("architecture")
        if platform.get("os") != "linux" or arch not in ARCHITECTURES or arch in actual:
            raise ValueError("Unexpected or duplicate platform in release manifest")
        child = manifest(f"{IMAGE}@{entry['digest']}")
        if child is None:
            raise ValueError("Release manifest references an unavailable image")
        actual[arch] = child.get("config", {}).get("digest")
    if actual != expected:
        raise ValueError(
            "Existing service version does not match the tested images; refusing to overwrite it"
        )


def publish(
    version: str, sha: str, artifacts: Path, *, verify_only: bool = False
) -> None:
    expected = {}
    for arch in ARCHITECTURES:
        directory = artifacts / f"service-{arch}"
        metadata = json.loads((directory / "image.json").read_text())
        if (
            metadata["sha"] != sha
            or metadata["version"] != version
            or metadata["architecture"] != arch
        ):
            raise ValueError(
                "Image artifact does not belong to this release commit/platform"
            )
        expected[arch] = metadata["config"]
    existing = None if verify_only else manifest(f"{IMAGE}:{version}")
    if existing is not None:
        verify_index(existing, expected)
        print("Service version already published and verified")
        return
    refs = []
    for arch in ARCHITECTURES:
        directory = artifacts / f"service-{arch}"
        local = f"phylo-lens-service:ci-{arch}"
        run("docker", "load", "--input", str(directory / "image.tar.gz"))
        image = json.loads(run("docker", "image", "inspect", local))[0]
        if (
            image["Id"] != expected[arch]
            or image["Architecture"] != arch
            or image["Os"] != "linux"
        ):
            raise ValueError("Saved image does not match its tested metadata")
        labels = image["Config"].get("Labels", {})
        if (
            labels.get("org.opencontainers.image.revision") != sha
            or labels.get("org.opencontainers.image.version") != version
        ):
            raise ValueError("Saved image has incorrect release labels")
        if verify_only:
            continue
        ref = f"{IMAGE}:{version}-{arch}"
        remote = manifest(ref)
        if remote is None:
            run("docker", "tag", local, ref)
            subprocess.run(["docker", "push", ref], check=True)
            remote = manifest(ref)
        if remote is None or remote.get("config", {}).get("digest") != expected[arch]:
            raise ValueError(f"Published {arch} image differs from the tested artifact")
        # Assemble using immutable manifest digests, not movable architecture tags.
        digest = run(
            "docker",
            "buildx",
            "imagetools",
            "inspect",
            ref,
            "--format",
            "{{.Manifest.Digest}}",
        )
        if not digest.startswith("sha256:"):
            raise ValueError("Registry did not return a manifest digest")
        refs.append(f"{IMAGE}@{digest}")
    if verify_only:
        print("Verified saved image identities for both platforms")
        return
    subprocess.run(
        [
            "docker",
            "buildx",
            "imagetools",
            "create",
            "--tag",
            f"{IMAGE}:{version}",
            *refs,
        ],
        check=True,
    )
    verify_index(manifest(f"{IMAGE}:{version}") or {}, expected)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("publish", "promote", "verify"))
    parser.add_argument("version")
    parser.add_argument("sha")
    parser.add_argument("artifacts", type=Path)
    args = parser.parse_args()
    parse_version(args.version)
    publish(
        args.version, args.sha, args.artifacts, verify_only=args.command == "verify"
    )
    if args.command == "promote":
        major, minor, _ = parse_version(args.version)
        source = f"{IMAGE}:{args.version}"
        digest = run(
            "docker",
            "buildx",
            "imagetools",
            "inspect",
            source,
            "--format",
            "{{.Manifest.Digest}}",
        )
        subprocess.run(
            [
                "docker",
                "buildx",
                "imagetools",
                "create",
                "--tag",
                f"{IMAGE}:latest",
                "--tag",
                f"{IMAGE}:{major}.{minor}",
                "--tag",
                f"{IMAGE}:{major}",
                f"{IMAGE}@{digest}",
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
