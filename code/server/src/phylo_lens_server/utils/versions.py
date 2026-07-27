from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

API_VERSION = "1"
PACKAGE_NAME = "phylo-lens-server"
SERVICE_VERSION_FALLBACK = "0.1.1"


def service_version() -> str:
    try:
        return version(PACKAGE_NAME)
    except PackageNotFoundError:
        return SERVICE_VERSION_FALLBACK
