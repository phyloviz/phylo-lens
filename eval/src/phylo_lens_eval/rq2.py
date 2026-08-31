"""Compatibility entry point for the RQ2 pilot runner."""

from .pilots.rq2 import *  # noqa: F403
from .pilots.rq2 import main


if __name__ == "__main__":
    main()
