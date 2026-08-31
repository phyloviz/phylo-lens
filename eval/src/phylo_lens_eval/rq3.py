"""Compatibility entry point for the RQ3 pilot runner."""

from .pilots.rq3 import *  # noqa: F403
from .pilots.rq3 import main


if __name__ == "__main__":
    main()
