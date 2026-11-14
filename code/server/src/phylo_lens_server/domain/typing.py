"""Mutually exclusive PhyloLib inference settings for allelic profiles."""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field

from .values import FrozenValue


class FullMstOptions(FrozenValue):
    model_config = ConfigDict(extra="forbid")

    algorithm: Literal["goeburstfullmst"] = "goeburstfullmst"


class GoeBurstOptions(FrozenValue):
    model_config = ConfigDict(extra="forbid")

    algorithm: Literal["goeburst"] = "goeburst"
    nlv: int = Field(default=3, ge=1, le=2_147_483_647, strict=True)


TypingOptions = Annotated[
    FullMstOptions | GoeBurstOptions, Field(discriminator="algorithm")
]
