"""Compatibility entry point; omit the tag to check repository consistency in CI."""

from __future__ import annotations

import sys

from release_version import check

if __name__ == "__main__":
    if len(sys.argv) > 2:
        raise SystemExit("usage: check-release-version.py [vX.Y.Z]")
    try:
        print(check(tag=sys.argv[1] if len(sys.argv) == 2 else None))
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error)) from error
