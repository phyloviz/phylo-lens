from pydantic import Field

from .values import FrozenValue

DEFAULT_SMALL_COMPONENT_THRESHOLD = 64


class LodOptions(FrozenValue):
    """Preparation policy, independent of layout forces and viewport preferences."""

    small_component_threshold: int = Field(
        default=DEFAULT_SMALL_COMPONENT_THRESHOLD, ge=0, strict=True
    )
