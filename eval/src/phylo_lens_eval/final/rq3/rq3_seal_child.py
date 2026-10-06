"""Build one RQ3 layout in a disposable child process before sealing it."""

from __future__ import annotations

from phylo_lens_server.domain.models import SourceFormat

import argparse
import json
from pathlib import Path

from phylo_lens_server.domain.preparation import PrepareInput
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.services.preparation import PreparationService
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)

from ...core.common import write_json


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    try:
        normalized = ingest_dataset(
            PrepareInput(
                format=SourceFormat.NEWICK,
                dataset_name=request["dataset_id"],
                content=Path(request["source_path"]).read_text(encoding="utf-8"),
            )
        )
        result = PreparationService(
            SQLiteLayoutRepository(Path(request["persistence_dir"]))
        ).prepare_dataset(normalized.dataset)
        write_json(
            args.output,
            {
                "state": "success",
                "dataset_id": normalized.dataset.dataset_id,
                "layout_version": result.artifacts.layout_version,
                "layout_status": result.layout_status,
            },
        )
    except Exception as error:
        write_json(
            args.output,
            {"state": "failure", "error": f"{type(error).__name__}: {error}"},
        )
        raise


if __name__ == "__main__":
    main()
