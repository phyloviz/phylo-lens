"""Compatibility entry point for the RQ4 pilot runner."""

from .pilots.rq4 import *  # noqa: F403
from .pilots.rq4 import main


if __name__ == "__main__":
    main()
