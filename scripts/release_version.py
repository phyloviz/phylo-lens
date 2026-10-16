"""Prepare and validate the coordinated stable release version (Python 3.12+)."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"


def parse_version(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(VERSION_PATTERN, value):
        raise ValueError(f"Expected stable X.Y.Z version, got {value!r}")
    return tuple(int(part) for part in value.split("."))


def tag_version(tag: str) -> str:
    if not tag.startswith("v"):
        raise ValueError(f"Expected release tag vX.Y.Z, got {tag!r}")
    parse_version(tag[1:])
    return tag[1:]


def read_match(root: Path, path: str, pattern: str) -> str:
    match = re.search(pattern, (root / path).read_text(), re.MULTILINE)
    if match is None:
        raise ValueError(f"Missing version declaration in {path}")
    return match.group(1)


def declarations(root: Path) -> dict[str, str]:
    package = json.loads((root / "code/client/package.json").read_text())
    lock = json.loads((root / "code/client/package-lock.json").read_text())
    server = tomllib.loads((root / "code/server/pyproject.toml").read_text())
    return {
        "client package": package["version"],
        "client lockfile": lock["version"],
        "client lockfile root": lock["packages"][""]["version"],
        "server package": server["project"]["version"],
        "service fallback": read_match(
            root,
            "code/server/src/phylo_lens_server/utils/versions.py",
            r'^SERVICE_VERSION_FALLBACK = "([^"\n]+)"$',
        ),
        "Docker default": read_match(
            root, "code/server/Dockerfile", r"^ARG VERSION=(.+)$"
        ),
        "Compose image": read_match(
            root,
            "code/server/compose.yaml",
            r"^    image: ghcr.io/phyloviz/phylo-lens-service:(.+)$",
        ),
    }


def check(root: Path = ROOT, tag: str | None = None) -> str:
    version = (root / "VERSION").read_text().strip()
    parse_version(version)
    if tag is not None and tag_version(tag) != version:
        raise ValueError(f"Tag {tag!r} does not match VERSION {version!r}")
    mismatches = [
        f"{name}: {value!r} (expected {version!r})"
        for name, value in declarations(root).items()
        if value != version
    ]
    if mismatches:
        raise ValueError("Release versions disagree:\n" + "\n".join(mismatches))
    return version


def next_version(current: str, tags: list[str], bump: str) -> str:
    versions = [parse_version(current)]
    for tag in tags:
        if re.fullmatch("v" + VERSION_PATTERN, tag):
            versions.append(parse_version(tag[1:]))
    major, minor, patch = max(versions)
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump != "patch":
        raise ValueError(f"Unknown version increment {bump!r}")
    return f"{major}.{minor}.{patch + 1}"


def prepare(root: Path, version: str) -> None:
    current = check(root)
    if parse_version(version) <= parse_version(current):
        raise ValueError("A new release must increase VERSION")
    edits = {"VERSION": version + "\n"}
    for path in ("code/client/package.json", "code/client/package-lock.json"):
        data = json.loads((root / path).read_text())
        data["version"] = version
        if "packages" in data:
            data["packages"][""]["version"] = version
        edits[path] = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    patterns = {
        "code/server/pyproject.toml": (
            r'^version = "[^"\n]+"$',
            f'version = "{version}"',
        ),
        "code/server/src/phylo_lens_server/utils/versions.py": (
            r'^SERVICE_VERSION_FALLBACK = "[^"\n]+"$',
            f'SERVICE_VERSION_FALLBACK = "{version}"',
        ),
        "code/server/Dockerfile": (r"^ARG VERSION=.+$", f"ARG VERSION={version}"),
        "code/server/compose.yaml": (
            r"^    image: ghcr.io/phyloviz/phylo-lens-service:.+$",
            f"    image: ghcr.io/phyloviz/phylo-lens-service:{version}",
        ),
    }
    # Validate every replacement before writing any file.
    for path, (pattern, replacement) in patterns.items():
        edits[path], count = re.subn(
            pattern, replacement, (root / path).read_text(), flags=re.MULTILINE
        )
        if count != 1:
            raise ValueError(
                f"Expected one version declaration in {path}, found {count}"
            )
    for path, content in edits.items():
        (root / path).write_text(content)
    check(root, "v" + version)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "prepare"))
    parser.add_argument("value", nargs="?")
    args = parser.parse_args()
    try:
        if args.command == "check":
            print(check(tag=args.value))
        else:
            tags = subprocess.check_output(
                ["git", "tag", "--list"], cwd=ROOT, text=True
            ).splitlines()
            version = next_version(check(), tags, args.value or "patch")
            prepare(ROOT, version)
            print(version)
    except (ValueError, KeyError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
