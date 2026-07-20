from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from phylo_lens_server.data.parsers import (
    WARN_NEWICK_FOREST,
    ParsedGraph,
    parse_newick_forest,
)

logger = logging.getLogger(__name__)

# Containerized PhyloLib CLI (https://github.com/phyloviz/phylolib). The image
# exposes `distance` and `algorithm` subcommands and reads/writes files under a
# mounted directory, addressed as <format>:<location>. We bind a host temp dir
# to CONTAINER_FILES_DIR and reference inputs/outputs by their in-container path.
DOCKER_COMMAND = "docker"
PHYLOLIB_IMAGE = "gonfrutuoso/phylolib:latest"
CONTAINER_FILES_DIR = "/files"

# Defaults per BACKLOG item 4: hamming for allelic MLST, goeBURST lvs=3, Newick
# output feeding the existing parse_newick path.
DEFAULT_DISTANCE_METHOD = "hamming"
DEFAULT_GOEBURST_LVS = 3
DATASET_FORMAT_ML = "ml"
MATRIX_FORMAT_SYMMETRIC = "symmetric"
TREE_FORMAT_NEWICK = "newick"

PROFILES_FILENAME = "profiles.txt"
MATRIX_FILENAME = "matrix.txt"
TREE_FILENAME = "tree.nwk"

# Error reasons surfaced to the caller so an operator can tell an unavailable
# container apart from an algorithm failure, mirroring the sfdp degrade reasons.
TYPING_DOCKER_MISSING = "docker_missing"
TYPING_PHYLOLIB_DISTANCE_FAILED = "phylolib_distance_failed"
TYPING_PHYLOLIB_ALGORITHM_FAILED = "phylolib_algorithm_failed"
TYPING_PHYLOLIB_EMPTY_TREE = "phylolib_empty_tree"

ERR_TYPING_DOCKER_MISSING = (
    "Typing-data ingest requires Docker to run the PhyloLib container, but the "
    "'docker' command was not found on PATH."
)
ERR_TYPING_DISTANCE_FAILED = (
    "PhyloLib failed to compute a distance matrix from the typing profiles."
)
ERR_TYPING_ALGORITHM_FAILED = (
    "PhyloLib failed to build a tree from the distance matrix."
)
ERR_TYPING_EMPTY_TREE = "PhyloLib produced an empty Newick tree."

# goeBURST emits one ``;``-terminated tree per connected component. Typing data
# is routinely disconnected (distant STs never join the MST), so the output is a
# forest. We parse each component independently and merge them into a single
# disconnected ParsedGraph, preserving true topology (no synthetic root).
WARN_TYPING_FOREST = (
    "PhyloLib produced {count} disconnected components; kept as a forest."
)


class TypingNormalizeError(ValueError):
    """Raised when the PhyloLib typing-data normalizer path cannot produce a tree.

    Carries a machine-readable ``reason`` (one of the ``TYPING_*`` constants)
    alongside the human-readable message.
    """

    def __init__(self, message: str, *, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def docker_available() -> bool:
    """Report whether the Docker CLI is on PATH (required for typing ingest)."""
    return shutil.which(DOCKER_COMMAND) is not None


def _run_phylolib(
    files_dir: Path, args: list[str], *, failure_reason: str, failure_message: str
) -> None:
    """Run one PhyloLib subcommand in the container with ``files_dir`` mounted."""
    command = [
        DOCKER_COMMAND,
        "run",
        "--rm",
        "-v",
        f"{files_dir}:{CONTAINER_FILES_DIR}",
        PHYLOLIB_IMAGE,
        *args,
    ]
    try:
        subprocess.run(command, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        stderr = getattr(error, "stderr", "") or ""
        logger.warning(
            "PhyloLib step %s failed (%s): %s",
            args[0] if args else "?",
            type(error).__name__,
            stderr.strip(),
        )
        raise TypingNormalizeError(failure_message, reason=failure_reason) from error


def typing_profiles_to_newick(
    profiles: str,
    *,
    distance_method: str = DEFAULT_DISTANCE_METHOD,
    goeburst_lvs: int = DEFAULT_GOEBURST_LVS,
) -> str:
    """Convert an MLST/cgMLST allelic profile matrix into raw PhyloLib Newick.

    Runs two PhyloLib container stages against a temp directory mounted at
    ``/files``: ``distance`` (profiles -> symmetric matrix) then ``algorithm
    goeburst`` (matrix -> Newick MST). The returned text may be a *forest* —
    one ``;``-terminated tree per connected component — which is normal for
    typing data. Raises :class:`TypingNormalizeError` when Docker is unavailable
    or either PhyloLib stage fails.
    """
    if not docker_available():
        logger.warning(ERR_TYPING_DOCKER_MISSING)
        raise TypingNormalizeError(
            ERR_TYPING_DOCKER_MISSING, reason=TYPING_DOCKER_MISSING
        )

    with tempfile.TemporaryDirectory(prefix="phylolib-") as tmp:
        files_dir = Path(tmp)
        (files_dir / PROFILES_FILENAME).write_text(profiles, encoding="utf-8")

        distance_in = f"{DATASET_FORMAT_ML}:{CONTAINER_FILES_DIR}/{PROFILES_FILENAME}"
        matrix_ref = (
            f"{MATRIX_FORMAT_SYMMETRIC}:{CONTAINER_FILES_DIR}/{MATRIX_FILENAME}"
        )
        _run_phylolib(
            files_dir,
            [
                "distance",
                distance_method,
                f"--dataset={distance_in}",
                f"--out={matrix_ref}",
            ],
            failure_reason=TYPING_PHYLOLIB_DISTANCE_FAILED,
            failure_message=ERR_TYPING_DISTANCE_FAILED,
        )

        tree_ref = f"{TREE_FORMAT_NEWICK}:{CONTAINER_FILES_DIR}/{TREE_FILENAME}"
        _run_phylolib(
            files_dir,
            [
                "algorithm",
                "goeburst",
                f"--matrix={matrix_ref}",
                f"--out={tree_ref}",
                f"--lvs={goeburst_lvs}",
            ],
            failure_reason=TYPING_PHYLOLIB_ALGORITHM_FAILED,
            failure_message=ERR_TYPING_ALGORITHM_FAILED,
        )

        tree_path = files_dir / TREE_FILENAME
        newick = (
            tree_path.read_text(encoding="utf-8").strip() if tree_path.exists() else ""
        )

    if not newick:
        logger.warning(ERR_TYPING_EMPTY_TREE)
        raise TypingNormalizeError(
            ERR_TYPING_EMPTY_TREE, reason=TYPING_PHYLOLIB_EMPTY_TREE
        )

    return newick


def typing_profiles_to_graph(
    profiles: str,
    *,
    distance_method: str = DEFAULT_DISTANCE_METHOD,
    goeburst_lvs: int = DEFAULT_GOEBURST_LVS,
) -> ParsedGraph:
    """Convert typing profiles into a ParsedGraph, tolerating a goeBURST forest.

    Wraps :func:`typing_profiles_to_newick`, then delegates to the shared
    ``parse_newick_forest`` path, which parses each ``;``-terminated component
    and merges them into a single disconnected graph (no synthetic root).
    Downstream clustering already partitions by connected component, so a forest
    flows through unchanged. The generic forest warning is swapped for a
    typing-specific one so an operator can tell where the components came from.
    """
    newick = typing_profiles_to_newick(
        profiles, distance_method=distance_method, goeburst_lvs=goeburst_lvs
    )

    parsed = parse_newick_forest(newick)

    generic_prefix = WARN_NEWICK_FOREST.split("{", 1)[0]
    if any(warning.startswith(generic_prefix) for warning in parsed.warnings):
        component_count = sum(1 for part in newick.split(";") if part.strip())
        parsed.warnings = [
            warning
            for warning in parsed.warnings
            if not warning.startswith(generic_prefix)
        ]
        typing_warning = WARN_TYPING_FOREST.format(count=component_count)
        parsed.warnings.append(typing_warning)
        logger.info(typing_warning)

    return parsed
