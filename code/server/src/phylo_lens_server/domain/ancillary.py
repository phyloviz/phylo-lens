"""Domain vocabulary: observations, their summaries, and represented isolates."""

from enum import StrEnum
from typing import Annotated

from pydantic import Field

from .values import FrozenMapping, FrozenValue

AncillaryValue = str | float | bool | None
AncillaryData = dict[str, AncillaryValue]
ReadonlyAncillaryData = FrozenMapping[str, AncillaryValue]
PositiveCount = Annotated[int, Field(strict=True, ge=1)]


class AncillaryType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    NULL = "null"


class AncillaryField(FrozenValue):
    key: str = Field(min_length=1)
    type: AncillaryType


class AncillarySummary(FrozenValue):
    values: ReadonlyAncillaryData = Field(default_factory=dict)
    category_counts: FrozenMapping[str, FrozenMapping[str, PositiveCount]] = Field(
        default_factory=dict
    )


class ProfileSummary(FrozenValue):
    # None means unavailable, not zero. LoD nodes sum the represented isolates.
    isolate_count: PositiveCount | None = None


class NodeAnnotations(FrozenValue):
    ancillary_data: ReadonlyAncillaryData = Field(default_factory=dict)
    ancillary_summary: AncillarySummary = Field(default_factory=AncillarySummary)
    profile_summary: ProfileSummary = Field(default_factory=ProfileSummary)


class AncillaryObservation(FrozenValue):
    """One joint ancillary row shared by count represented isolates."""

    values: ReadonlyAncillaryData = Field(default_factory=dict)
    count: PositiveCount
