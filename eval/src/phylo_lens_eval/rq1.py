"""Compatibility entry point for the RQ1 pilot runner."""

from .pilots.rq1 import *  # noqa: F403
from .pilots.rq1 import main


if __name__ == "__main__":
    main()
