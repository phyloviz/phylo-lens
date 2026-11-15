"""Immutable preparation provenance needed to change technical orientation."""

from dataclasses import dataclass

from .dataset import Dataset
from .lod import LodOptions
from .preparation import PreparationSummary
from .sfdp import SfdpOptions
from .values import FrozenValue


class PreparationSnapshot(FrozenValue):
    dataset: Dataset
    default_roots: tuple[str, ...]
    default_rooting_strategy: str
    sfdp_options: SfdpOptions
    lod_options: LodOptions


@dataclass(frozen=True)
class RootingUpdate:
    dataset_id: str
    layout_version: str
    node_id: str | None


@dataclass(frozen=True)
class RootingResult:
    summary: PreparationSummary
    component_ids: dict[str, str]
    default_roots: tuple[str, ...]
