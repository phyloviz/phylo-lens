from __future__ import annotations

import logging

from phylo_lens_server.config.settings import postgres_dsn
from phylo_lens_server.repository.jobs.postgres import PostgresPrepareJobStore

logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    PostgresPrepareJobStore(postgres_dsn()).create_schema()
    logger.info("Postgres schema is up to date.")


if __name__ == "__main__":
    main()
