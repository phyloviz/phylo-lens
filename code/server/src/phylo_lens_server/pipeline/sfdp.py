from __future__ import annotations

from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SfdpOverlap(StrEnum):
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
    """Graphviz SFDP configuration."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    k: float = Field(
        default=0.3,
        gt=0,
        strict=True,
        allow_inf_nan=False,
    )

    repulsive_force: float = Field(
        default=1.0,
        alias="repulsiveForce",
        ge=0,
        strict=True,
        allow_inf_nan=False,
    )

    overlap: SfdpOverlap = SfdpOverlap.PRISM

    prism_iterations: int = Field(
        default=0,
        alias="prismIterations",
        ge=0,
        strict=True,
    )

    overlap_scaling: float = Field(
        default=-4.0,
        alias="overlapScaling",
        strict=True,
        allow_inf_nan=False,
    )

    smoothing: SfdpSmoothing = SfdpSmoothing.SPRING
    quadtree: SfdpQuadtree = SfdpQuadtree.NORMAL
    beautify: bool = False

    @model_validator(mode="after")
    def validate_overlap_options(self) -> Self:
        if self.overlap == SfdpOverlap.SCALE:
            if "prism_iterations" in self.model_fields_set:
                raise ValueError("prismIterations requires Prism overlap removal.")
            if "overlap_scaling" in self.model_fields_set:
                raise ValueError("overlapScaling requires Prism overlap removal.")

        return self

    def dot_attributes(self) -> dict[str, str | float | bool]:
        attributes: dict[str, str | float | bool] = {
            "K": self.k,
            "repulsiveforce": self.repulsive_force,
            "overlap": (
                f"prism{self.prism_iterations}"
                if self.overlap == SfdpOverlap.PRISM
                else self.overlap.value
            ),
        }
        if self.overlap == SfdpOverlap.PRISM:
            attributes["overlap_scaling"] = self.overlap_scaling
        attributes.update(
            smoothing=self.smoothing.value,
            quadtree=self.quadtree.value,
            beautify=self.beautify,
        )
        return attributes


def resolve_sfdp_options(options: SfdpOptions | None) -> SfdpOptions:
    return options if options is not None else SfdpOptions()


__all__ = [
    "SfdpOptions",
    "SfdpOverlap",
    "SfdpQuadtree",
    "SfdpSmoothing",
    "resolve_sfdp_options",
]
