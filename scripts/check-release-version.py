from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIENT_PACKAGE = ROOT / "code" / "client" / "package.json"
SERVER_PROJECT = ROOT / "code" / "server" / "pyproject.toml"
SERVER_VERSIONS = ROOT / "code" / "server" / "src" / "phylo_lens_server" / "versions.py"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-release-version.py vX.Y.Z", file=sys.stderr)
        return 2

    tag = sys.argv[1]
    release_version = tag.removeprefix("v")
    if tag == release_version or not re.fullmatch(r"\d+\.\d+\.\d+", release_version):
        print(f"release tag must use vX.Y.Z format, got {tag!r}", file=sys.stderr)
        return 1

    client_version = json.loads(CLIENT_PACKAGE.read_text(encoding="utf-8"))["version"]
    server_version = tomllib.loads(SERVER_PROJECT.read_text(encoding="utf-8"))["project"]["version"]
    api_version = read_api_version()

    mismatches = [
        ("client package", client_version),
        ("server package", server_version),
    ]
    mismatches = [(name, version) for name, version in mismatches if version != release_version]
    if mismatches:
        for name, version in mismatches:
            print(
                f"{name} version {version!r} does not match release tag {release_version!r}",
                file=sys.stderr,
            )
        return 1

    print(f"release_version={release_version}")
    print(f"client_version={client_version}")
    print(f"server_version={server_version}")
    print(f"api_version={api_version}")
    return 0


def read_api_version() -> str:
    match = re.search(
        r'^API_VERSION\s*=\s*["\']([^"\']+)["\']',
        SERVER_VERSIONS.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    if match is None:
        raise RuntimeError(f"API_VERSION not found in {SERVER_VERSIONS}")
    return match.group(1)


if __name__ == "__main__":
    raise SystemExit(main())
