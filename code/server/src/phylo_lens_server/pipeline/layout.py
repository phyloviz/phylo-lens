from __future__ import annotations

import shlex
import shutil
import subprocess
from dataclasses import dataclass
from math import hypot

from phylo_lens_server.config.settings import graphviz_sfdp_timeout_seconds
from phylo_lens_server.domain.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.pipeline.models import (
    ClusterLayout,
    LayoutBounds,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
)
from phylo_lens_server.pipeline.sfdp import SfdpOptions, resolve_sfdp_options

GRAPHVIZ_SFDP_COMMAND = "sfdp"


@dataclass(frozen=True)
class LayoutFailureDiagnostics:
    algorithm: str = "sfdp"
    stage: str = "global_layout"
    exit_status: int | None = None
    timeout_seconds: float | None = None
    stderr: str | None = None
    detail: str | None = None

    def as_dict(self) -> dict[str, str | int | float | None]:
        return {
            "algorithm": self.algorithm,
            "stage": self.stage,
            "exit_status": self.exit_status,
            "timeout_seconds": self.timeout_seconds,
            "stderr": self.stderr,
            "detail": self.detail,
        }


class GraphvizLayoutError(RuntimeError):
    def __init__(self, message: str, diagnostics: LayoutFailureDiagnostics) -> None:
        super().__init__(message)
        self.diagnostics = diagnostics


def compute_prepared_layouts(
    artifacts: PreparedLayoutArtifacts,
) -> tuple[tuple[ClusterLayout, ...], tuple[NodeLayoutPosition, ...]]:
    global_positions = compute_global_node_positions(
        artifacts.dataset,
        artifacts.sfdp_options,
    )

    cluster_layouts: list[ClusterLayout] = []
    singleton_cluster_by_node_id: dict[str, str] = {}
    fallback_cluster_by_node_id: dict[str, str] = {}

    for cluster in artifacts.clusters:
        member_positions = {
            node_id: global_positions[node_id] for node_id in cluster.member_node_ids
        }

        for node_id in cluster.member_node_ids:
            fallback_cluster_by_node_id.setdefault(node_id, cluster.cluster_id)
            if cluster.member_count == 1:
                singleton_cluster_by_node_id[node_id] = cluster.cluster_id

        representative_position = global_positions[cluster.representative_node_id]
        bounds, radius = cluster_geometry(member_positions, representative_position)

        cluster_layouts.append(
            ClusterLayout(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                cluster_id=cluster.cluster_id,
                representative_node_id=cluster.representative_node_id,
                member_count=cluster.member_count,
                x=representative_position[0],
                y=representative_position[1],
                radius=radius,
                bounds=bounds,
                status="ready",
            )
        )

    node_positions = tuple(
        NodeLayoutPosition(
            dataset_id=artifacts.dataset.dataset_id,
            layout_version=artifacts.layout_version,
            cluster_id=singleton_cluster_by_node_id.get(
                node_id,
                fallback_cluster_by_node_id[node_id],
            ),
            node_id=node_id,
            x=x,
            y=y,
            status="ready",
        )
        for node_id, (x, y) in sorted(global_positions.items())
        if node_id in fallback_cluster_by_node_id
    )

    return tuple(cluster_layouts), node_positions


def compute_global_node_positions(
    dataset: CanonicalDataset,
    options: SfdpOptions | None = None,
) -> dict[str, tuple[float, float]]:
    node_ids = tuple(sorted(node.id for node in dataset.nodes))

    if not node_ids:
        return {}
    if len(node_ids) == 1:
        return {node_ids[0]: (0.0, 0.0)}

    return graphviz_sfdp_positions(node_ids, tuple(dataset.edges), options)


def graphviz_sfdp_positions(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
    options: SfdpOptions | None = None,
) -> dict[str, tuple[float, float]]:
    if shutil.which(GRAPHVIZ_SFDP_COMMAND) is None:
        raise _layout_error(
            "Graphviz 'sfdp' was not found on PATH.",
            detail="The sfdp executable was not found on PATH.",
        )

    timeout_seconds = graphviz_sfdp_timeout_seconds()

    try:
        completed = subprocess.run(
            [GRAPHVIZ_SFDP_COMMAND, "-Tplain"],
            input=graphviz_dot_payload(node_ids, edges, options),
            text=True,
            capture_output=True,
            check=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise _layout_error(
            "Graphviz 'sfdp' timed out.",
            timeout_seconds=timeout_seconds,
            stderr=_error_stderr(error),
        ) from error
    except subprocess.CalledProcessError as error:
        raise _layout_error(
            f"Graphviz 'sfdp' exited with status {error.returncode}.",
            exit_status=error.returncode,
            stderr=_error_stderr(error),
        ) from error
    except OSError as error:
        raise _layout_error(
            "Graphviz 'sfdp' could not be started.",
            detail=str(error),
        ) from error

    try:
        positions = parse_graphviz_plain_positions(completed.stdout)
    except ValueError as error:
        raise _layout_error(
            "Graphviz 'sfdp' returned invalid output.",
            detail=str(error),
        ) from error

    if set(positions) != set(node_ids):
        raise _layout_error(
            "Graphviz 'sfdp' returned incomplete output.",
            detail=f"Expected {len(node_ids)} nodes, got {len(positions)}.",
        )

    return positions


def graphviz_dot_payload(
    node_ids: tuple[str, ...],
    edges: tuple[CanonicalEdge, ...],
    options: SfdpOptions | None = None,
) -> str:
    options = resolve_sfdp_options(options)
    known_node_ids = set(node_ids)

    attributes: dict[str, str | float | bool] = {
        **options.dot_attributes(),
        "pack": True,
        "splines": False,
    }

    graph_attributes = ", ".join(
        f"{name}={format_dot_value(value)}" for name, value in attributes.items()
    )

    lines = [
        "graph {",
        f"  graph [{graph_attributes}];",
        '  node [shape=point, width=0.04, height=0.04, label=""];',
        *(f"  {quote_dot(node_id)};" for node_id in node_ids),
    ]

    lines.extend(
        f"  {quote_dot(edge.source)} -- {quote_dot(edge.target)};"
        for edge in edges
        if edge.source in known_node_ids and edge.target in known_node_ids
    )
    lines.append("}")

    return "\n".join(lines)


def parse_graphviz_plain_positions(
    output: str,
) -> dict[str, tuple[float, float]]:
    positions: dict[str, tuple[float, float]] = {}

    for line in output.splitlines():
        parts = shlex.split(line)
        if len(parts) >= 4 and parts[0] == "node":
            positions[unescape_plain_id(parts[1])] = (
                float(parts[2]),
                float(parts[3]),
            )

    return positions


def cluster_geometry(
    positions: dict[str, tuple[float, float]],
    center: tuple[float, float],
) -> tuple[LayoutBounds, float]:
    if not positions:
        return LayoutBounds(min_x=0.0, max_x=0.0, min_y=0.0, max_y=0.0), 0.0

    min_x = min(x for x, _ in positions.values())
    max_x = max(x for x, _ in positions.values())
    min_y = min(y for _, y in positions.values())
    max_y = max(y for _, y in positions.values())
    radius = max(hypot(x - center[0], y - center[1]) for x, y in positions.values())

    return LayoutBounds(min_x=min_x, max_x=max_x, min_y=min_y, max_y=max_y), radius


def format_dot_value(value: str | float | bool) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return quote_dot(value)
    return f"{value:g}"


def quote_dot(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def unescape_plain_id(value: str) -> str:
    return value.replace('\\"', '"').replace("\\\\", "\\")


def _layout_error(
    message: str,
    *,
    exit_status: int | None = None,
    timeout_seconds: float | None = None,
    stderr: str | None = None,
    detail: str | None = None,
) -> GraphvizLayoutError:
    return GraphvizLayoutError(
        message,
        LayoutFailureDiagnostics(
            exit_status=exit_status,
            timeout_seconds=timeout_seconds,
            stderr=stderr,
            detail=detail,
        ),
    )


def _error_stderr(error: BaseException) -> str | None:
    stderr = getattr(error, "stderr", None)
    if isinstance(stderr, bytes):
        stderr = stderr.decode(errors="replace")
    return stderr.strip() if isinstance(stderr, str) and stderr.strip() else None
