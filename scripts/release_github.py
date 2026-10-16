"""Announce only a completed coordinated release; safely resume after an API failure."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from release_version import tag_version


def request(path: str, data: dict | None = None) -> dict | None:
    repository = os.environ["GITHUB_REPOSITORY"]
    if repository != "phyloviz/phylo-lens":
        raise ValueError("Releases are only published from the canonical repository")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and data is None:
            return None
        raise


def main(tag: str) -> None:
    tag_version(tag)
    existing = request(f"releases/tags/{tag}")
    if existing is not None:
        if existing["draft"] or existing["prerelease"]:
            raise ValueError(
                "Existing release is a draft/prerelease; resolve it before retrying"
            )
        print(f"Release already announced: {existing['html_url']}")
        return
    notes = Path("RELEASE_NOTES.md").read_text()
    notes += f"\n\nArtifacts: `@phyloviz/phylo-lens@{tag[1:]}` and `ghcr.io/phyloviz/phylo-lens-service:{tag[1:]}` (linux/amd64, linux/arm64).\n"
    result = request(
        "releases",
        {
            "tag_name": tag,
            "name": tag,
            "body": notes,
            "draft": False,
            "prerelease": False,
            "make_latest": "true",
        },
    )
    print(f"Release published: {result['html_url']}")


if __name__ == "__main__":
    main(sys.argv[1])
