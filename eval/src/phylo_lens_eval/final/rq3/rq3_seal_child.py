"""Build one RQ3 layout in a disposable child process before sealing it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from phylo_lens_server.data.normalizer import (
    NormalizeFormat,
    NormalizeRequest,
    normalize_dataset,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

from ...core.common import write_json


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    try:
        normalized = normalize_dataset(
            NormalizeRequest(
                format=NormalizeFormat.NEWICK,
                dataset_name=request["dataset_id"],
                content=Path(request["source_path"]).read_text(encoding="utf-8"),
            )
        )
        result = PreparedLayoutWorker(
            PreparedLayoutStore(Path(request["persistence_dir"]))
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
