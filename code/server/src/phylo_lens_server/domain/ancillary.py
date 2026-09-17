"""Domain vocabulary: observations, their summaries, and represented isolates."""

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field

AncillaryValue = str | float | bool | None
AncillaryData = dict[str, AncillaryValue]
PositiveCount = Annotated[int, Field(strict=True, ge=1)]


class AncillaryType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    NULL = "null"


class AncillaryField(BaseModel):
    key: str = Field(min_length=1)
    type: AncillaryType


class AncillarySummary(BaseModel):
    values: AncillaryData = Field(default_factory=dict)
    category_counts: dict[str, dict[str, PositiveCount]] = Field(default_factory=dict)


class ProfileSummary(BaseModel):
    # None means unavailable, not zero. LoD nodes sum the represented isolates.
    isolate_count: PositiveCount | None = None


class NodeAnnotations(BaseModel):
    ancillary_data: AncillaryData = Field(default_factory=dict)
    ancillary_summary: AncillarySummary = Field(default_factory=AncillarySummary)
    profile_summary: ProfileSummary = Field(default_factory=ProfileSummary)


class AncillaryObservation(BaseModel):
    """One joint ancillary row shared by count represented isolates."""

    values: AncillaryData = Field(default_factory=dict)
    count: PositiveCount
