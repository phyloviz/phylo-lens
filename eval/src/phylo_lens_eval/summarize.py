"""Compatibility entry point for the RQ1 pilot summarizer."""

from .pilots.rq1_summary import *  # noqa: F403
from .pilots.rq1_summary import main


if __name__ == "__main__":
    main()
