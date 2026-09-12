from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class SfdpOverlap(StrEnum):
    """Overlap-removal modes intentionally supported by PhyloLens."""

    PRISM0 = "prism0"
    PRISM = "prism"
    SCALE = "scale"


class SfdpSmoothing(StrEnum):
    NONE = "none"
    AVG_DIST = "avg_dist"
    GRAPH_DIST = "graph_dist"
    POWER_DIST = "power_dist"
    RNG = "rng"
    SPRING = "spring"
    TRIANGLE = "triangle"


class SfdpQuadtree(StrEnum):
    NONE = "none"
    NORMAL = "normal"
    FAST = "fast"


class SfdpOptions(BaseModel):
    """Optional, SFDP-specific Graphviz overrides for a prepared layout.

    ``None`` means that no DOT attribute is emitted, preserving Graphviz's own
    default for that option.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    k: float | None = Field(
        default=None,
        gt=0,
        strict=True,
        allow_inf_nan=False,
    )
    repulsive_force: float | None = Field(
        default=None,
        alias="repulsiveForce",
        ge=0,
        strict=True,
        allow_inf_nan=False,
    )
    overlap: SfdpOverlap | None = None
    overlap_scaling: float | None = Field(
        default=None,
        alias="overlapScaling",
        strict=True,
        allow_inf_nan=False,
    )
    smoothing: SfdpSmoothing | None = None
    quadtree: SfdpQuadtree | None = None
    beautify: bool | None = None

    def dot_attributes(self) -> dict[str, str | float | bool]:
        attributes: dict[str, str | float | bool | None] = {
            "K": self.k,
            "repulsiveforce": self.repulsive_force,
            "overlap": self.overlap,
            "overlap_scaling": self.overlap_scaling,
            "smoothing": self.smoothing,
            "quadtree": self.quadtree,
            "beautify": self.beautify,
        }
        return {name: value for name, value in attributes.items() if value is not None}


def resolve_sfdp_options(options: SfdpOptions | None) -> SfdpOptions:
    return options if options is not None else SfdpOptions()


__all__ = [
    "SfdpOptions",
    "SfdpOverlap",
    "SfdpQuadtree",
    "SfdpSmoothing",
    "resolve_sfdp_options",
]
