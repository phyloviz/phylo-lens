"""Immutable Pydantic values with JSON-compatible read-only mappings."""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Annotated, Self, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, PlainSerializer

K = TypeVar("K")
V = TypeVar("V")


def serialize_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {key: serialize_value(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return tuple(serialize_value(item) for item in value)
    return value


FrozenMapping = Annotated[
    Mapping[K, V],
    AfterValidator(lambda value: MappingProxyType(dict(value))),
    PlainSerializer(serialize_value),
]


class FrozenValue(BaseModel):
    model_config = ConfigDict(frozen=True, validate_default=True)

    def model_copy(
        self, *, update: Mapping[str, object] | None = None, deep: bool = False
    ) -> Self:
        # Pydantic's default copy bypasses validation and can reintroduce lists
        # and mutable dictionaries. Reconstruct published values on updates.
        if update or deep:
            return type(self).model_validate({**self.model_dump(), **(update or {})})
        return super().model_copy()
