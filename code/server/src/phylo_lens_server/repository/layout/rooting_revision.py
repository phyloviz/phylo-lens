"""Read and publish a rooted revision inside the repository's transaction."""

from dataclasses import dataclass

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.preparation import PreparedLayoutResult
from phylo_lens_server.domain.rooting import PreparationSnapshot

from . import writer
from .ancillary_revision import require_published


@dataclass(frozen=True)
class RootingRevision:
    connection: LayoutSQL
    source: PreparationSnapshot
    positions: dict[str, tuple[float, float]]

    def publish(self, result: PreparedLayoutResult) -> None:
        artifacts = result.artifacts
        dataset_id = artifacts.dataset.dataset_id
        version = artifacts.layout_version
        inserted = self.connection.execute(
            """insert into datasets(dataset_id, layout_version, status) values (?, ?, 'refining')
                on conflict do nothing returning layout_version""",
            (dataset_id, version),
        ).fetchone()
        if inserted is None:
            placeholder = "?" if self.connection.backend == "sqlite" else "%s"
            require_published(
                self.connection.connection, dataset_id, version, placeholder
            )
            return
        writer.save_artifacts(
            self.connection,
            artifacts,
            snapshot=self.source.model_copy(update={"dataset": artifacts.dataset}),
        )
        writer.save_layouts(
            self.connection, result.cluster_layouts, result.node_positions
        )
        writer.save_prepared_edges(self.connection, result.prepared_edges)
        writer.publish_layout_version(
            self.connection,
            dataset_id=dataset_id,
            layout_version=version,
            status=result.layout_status,
        )


def open_revision(
    connection: LayoutSQL, dataset_id: str, version: str
) -> RootingRevision:
    lock = " for share" if connection.backend == "postgres" else ""
    row = connection.execute(
        "select status from datasets where dataset_id = ? and layout_version = ?"
        + lock,
        (dataset_id, version),
    ).fetchone()
    if row is None or row["status"] not in ("ready", "degraded"):
        raise KeyError(version)
    row = connection.execute(
        "select snapshot_json from preparation_sources where dataset_id = ? and layout_version = ?",
        (dataset_id, version),
    ).fetchone()
    if row is None:
        raise ValueError(
            "This layout predates technical rerooting; load the dataset again."
        )
    source = PreparationSnapshot.model_validate_json(row["snapshot_json"])
    positions = {
        row["node_id"]: (row["x"], row["y"])
        for row in connection.execute(
            "select node_id, x, y from node_positions where dataset_id = ? and layout_version = ?",
            (dataset_id, version),
        )
    }
    if set(positions) != {node.id for node in source.dataset.nodes}:
        raise ValueError("The prepared geometry is incomplete; load the dataset again.")
    return RootingRevision(connection, source, positions)
