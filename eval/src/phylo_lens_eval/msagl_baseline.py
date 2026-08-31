"""Compatibility entry point for the MSAGL baseline runner."""

from .baselines.msagl_baseline import *  # noqa: F403
from .baselines.msagl_baseline import main


if __name__ == "__main__":
    main()
