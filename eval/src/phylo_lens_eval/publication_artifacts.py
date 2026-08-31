"""Compatibility entry point for publication-artifact generation."""

from .reporting.publication_artifacts import *  # noqa: F403
from .reporting.publication_artifacts import main


if __name__ == "__main__":
    main()
