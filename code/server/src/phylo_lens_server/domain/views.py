"""Immutable graph query and view values shared by HTTP, services and persistence."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal

from .ancillary import AncillaryField, AncillaryObservation
from .models import Isolate

LayoutStatus = Literal["pending", "refining", "ready", "degraded", "failed"]


@dataclass(frozen=True)
class LayoutBounds:
    min_x: float
    max_x: float
    min_y: float
    max_y: float


@dataclass(frozen=True)
class ViewportNode:
    node_id: str
    cluster_id: str
    x: float
    y: float
    layout_status: LayoutStatus
    member_count: int = 1
    is_representative: bool = False
    metadata: Mapping[str, str | float | bool | None] | None = None
    isolates: tuple[Isolate, ...] = ()
    ancillary_distribution: tuple[AncillaryObservation, ...] = ()

    def __post_init__(self) -> None:
        if self.metadata is not None:
            object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))


@dataclass(frozen=True)
class ViewportEdge:
    edge_id: str
    source: str
    target: str
    distance: float | None
    # Expansion edges retain an attachment to a neighboring representative.
    is_meta: bool | None = None


@dataclass(frozen=True)
class ViewportReadResult:
    dataset_id: str
    layout_version: str
    nodes: tuple[ViewportNode, ...]
    edges: tuple[ViewportEdge, ...]
    total_node_count: int
    truncated: bool
    layout_status: LayoutStatus
    global_bounds: LayoutBounds | None = None
    metadata_schema: tuple[AncillaryField, ...] = ()
    lod_level: int | None = None
    zoom: float = 1.0


@dataclass(frozen=True)
class RegionReadResult:
    dataset_id: str
    layout_version: str
    nodes: tuple[ViewportNode, ...]
    edges: tuple[ViewportEdge, ...]
    total_node_count: int
    truncated: bool
    layout_status: LayoutStatus
    metadata_schema: tuple[AncillaryField, ...] = ()
    # One aggregated value per metadata field across the selected members
    # (mean for numeric fields, mode for everything else).
    aggregated_metadata: Mapping[str, str | float | bool | None] = field(
        default_factory=dict
    )

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "aggregated_metadata",
            MappingProxyType(dict(self.aggregated_metadata)),
        )


@dataclass(frozen=True)
class RegionQuery:
    dataset_id: str
    xmin: float
    xmax: float
    ymin: float
    ymax: float
    layout_version: str | None = None
    max_nodes: int | None = None


@dataclass(frozen=True)
class ViewportBounds:
    xmin: float
    xmax: float
    ymin: float
    ymax: float


@dataclass(frozen=True)
class ViewportQuery:
    dataset_id: str
    layout_version: str | None = None
    cluster_id: str | None = None
    focus_node_id: str | None = None
    xmin: float | None = None
    xmax: float | None = None
    ymin: float | None = None
    ymax: float | None = None
    zoom: float = 1.0
    lod_level: int | None = None
    max_nodes: int | None = None
    lod_target_representations: int | None = None
    lod_selection_bounds: ViewportBounds | None = None
    previous_lod_level: int | None = None


"""Choose among existing structural tiers; never discard representations."""

VIEWPORT_LOD_HYSTERESIS_RATIO = 0.15
VIEWPORT_LOD_EARLY_REFINEMENT_FACTOR = 2


def select_viewport_lod_level(
    counts: dict[int, int],
    semantic_level: int,
    target_representations: int,
    previous_level: int | None = None,
) -> int:
    """Zoom is a preference; spare viewport capacity permits early refinement.

    Each tier ahead of the preferred tier gets half the base target. Scan all
    tiers because local representation counts need not be monotonic. Count the
    prospective representation, including finest-tier one-hop neighbors.
    Density hysteresis uses each tier's own target, so zooming out tightens the
    condition for keeping an early-refined tier. Never truncate a valid tier.
    """
    if target_representations < 1:
        raise ValueError("Viewport representation target must be positive.")
    levels = sorted(counts)
    if not levels:
        return semantic_level

    # Integer comparisons avoid overflow and preserve positive-count checks even
    # when a caller supplies a very large preferred-tier offset.
    def scaled_count(level: int) -> int:
        return counts[level] * VIEWPORT_LOD_EARLY_REFINEMENT_FACTOR ** max(
            0, level - semantic_level
        )

    fitting = [
        level for level in levels if scaled_count(level) <= target_representations
    ]
    chosen = max(fitting) if fitting else levels[0]
    if previous_level in levels:
        previous_count = scaled_count(previous_level)
        if previous_count <= target_representations * (
            1 + VIEWPORT_LOD_HYSTERESIS_RATIO
        ):
            if chosen < previous_level:
                return previous_level
            if chosen > previous_level:
                # If the finest fitting tier is near its threshold, still take
                # a comfortable intermediate refinement instead of freezing.
                comfortable = [
                    level
                    for level in levels
                    if level > previous_level
                    and scaled_count(level)
                    <= target_representations * (1 - VIEWPORT_LOD_HYSTERESIS_RATIO)
                ]
                return max(comfortable) if comfortable else previous_level
    return chosen
