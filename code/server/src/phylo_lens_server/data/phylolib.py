from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path

from phylo_lens_server.config.settings import phylolib_timeout_seconds
from phylo_lens_server.data.parsers import (
    WARN_NEWICK_FOREST,
    ParsedGraph,
    parse_newick_forest,
)

logger = logging.getLogger(__name__)

# PhyloLib CLI (https://github.com/phyloviz/phylolib). The PhyloLens service
# image runs the bundled JAR directly; the rest of the normalization pipeline
# only deals with typing profiles and parsed Newick output.
JAVA_COMMAND = "java"
ENV_PHYLOLIB_JAR = "PHYLO_LENS_PHYLOLIB_JAR"
ENV_PHYLOLIB_JAVA = "PHYLO_LENS_PHYLOLIB_JAVA"

# Defaults: Hamming for allelic MLST, goeBURST lvs=3, then Newick
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
# PhyloLib runtime apart from an algorithm failure, mirroring the sfdp degrade
# reasons.
TYPING_PHYLOLIB_RUNTIME_MISSING = "phylolib_runtime_missing"
TYPING_PHYLOLIB_DISTANCE_FAILED = "phylolib_distance_failed"
TYPING_PHYLOLIB_ALGORITHM_FAILED = "phylolib_algorithm_failed"
TYPING_PHYLOLIB_DISTANCE_TIMEOUT = "phylolib_distance_timeout"
TYPING_PHYLOLIB_ALGORITHM_TIMEOUT = "phylolib_algorithm_timeout"
TYPING_PHYLOLIB_EMPTY_TREE = "phylolib_empty_tree"

ERR_TYPING_PHYLOLIB_RUNTIME_MISSING = (
    "Typing-data ingest requires a readable PhyloLib JAR configured with "
    f"{ENV_PHYLOLIB_JAR}."
)
ERR_TYPING_DISTANCE_FAILED = (
    "PhyloLib failed to compute a distance matrix from the typing profiles."
)
ERR_TYPING_ALGORITHM_FAILED = (
    "PhyloLib failed to build a tree from the distance matrix."
)
ERR_TYPING_DISTANCE_TIMEOUT = (
    "PhyloLib timed out while computing a distance matrix from the typing profiles."
)
ERR_TYPING_ALGORITHM_TIMEOUT = (
    "PhyloLib timed out while building a tree from the distance matrix."
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


def _configured_phylolib_jar() -> Path | None:
    jar_path = os.environ.get(ENV_PHYLOLIB_JAR)
    if not jar_path:
        return None

    path = Path(jar_path)
    return path if path.is_file() else None


def phylolib_jar_available() -> bool:
    """Report whether a local PhyloLib JAR is configured and readable."""
    return _configured_phylolib_jar() is not None


def _java_command() -> str:
    return os.environ.get(ENV_PHYLOLIB_JAVA, JAVA_COMMAND)


def _run_phylolib_cli(
    args: list[str],
    *,
    failure_reason: str,
    failure_message: str,
    timeout_reason: str,
    timeout_message: str,
) -> None:
    """Run one PhyloLib CLI subcommand through the configured local JAR."""
    jar_path = _configured_phylolib_jar()
    if jar_path is None:
        raise TypingNormalizeError(
            ERR_TYPING_PHYLOLIB_RUNTIME_MISSING,
            reason=TYPING_PHYLOLIB_RUNTIME_MISSING,
        )

    command = [_java_command(), "-jar", str(jar_path), *args]
    _run_command(
        command,
        step=args[0] if args else "?",
        failure_reason=failure_reason,
        failure_message=failure_message,
        timeout_reason=timeout_reason,
        timeout_message=timeout_message,
    )


def _run_command(
    command: list[str],
    *,
    step: str,
    failure_reason: str,
    failure_message: str,
    timeout_reason: str,
    timeout_message: str,
) -> None:
    try:
        subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=phylolib_timeout_seconds(),
        )
    except subprocess.TimeoutExpired as error:
        logger.warning(
            "PhyloLib step %s timed out after %.1f seconds.",
            step,
            phylolib_timeout_seconds(),
        )
        raise TypingNormalizeError(timeout_message, reason=timeout_reason) from error
    except (OSError, subprocess.CalledProcessError) as error:
        stderr = getattr(error, "stderr", "") or ""
        logger.warning(
            "PhyloLib step %s failed (%s): %s",
            step,
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

    Runs two PhyloLib stages against a temp directory: ``distance`` (profiles ->
    symmetric matrix) then ``algorithm goeburst`` (matrix -> Newick MST). The
    returned text may be a *forest* — one ``;``-terminated tree per connected
    component — which is normal for typing data. Raises
    :class:`TypingNormalizeError` when no PhyloLib runtime is available or either
    stage fails.
    """
    with tempfile.TemporaryDirectory(prefix="phylolib-") as tmp:
        files_dir = Path(tmp)
        (files_dir / PROFILES_FILENAME).write_text(profiles, encoding="utf-8")

        profiles_path = str(files_dir / PROFILES_FILENAME)
        matrix_path = str(files_dir / MATRIX_FILENAME)
        tree_path = files_dir / TREE_FILENAME
        distance_in = f"{DATASET_FORMAT_ML}:{profiles_path}"
        matrix_ref = f"{MATRIX_FORMAT_SYMMETRIC}:{matrix_path}"
        _run_phylolib_cli(
            [
                "distance",
                distance_method,
                f"--dataset={distance_in}",
                f"--out={matrix_ref}",
            ],
            failure_reason=TYPING_PHYLOLIB_DISTANCE_FAILED,
            failure_message=ERR_TYPING_DISTANCE_FAILED,
            timeout_reason=TYPING_PHYLOLIB_DISTANCE_TIMEOUT,
            timeout_message=ERR_TYPING_DISTANCE_TIMEOUT,
        )

        tree_ref = f"{TREE_FORMAT_NEWICK}:{tree_path}"
        _run_phylolib_cli(
            [
                "algorithm",
                "goeburst",
                f"--matrix={matrix_ref}",
                f"--out={tree_ref}",
                f"--lvs={goeburst_lvs}",
            ],
            failure_reason=TYPING_PHYLOLIB_ALGORITHM_FAILED,
            failure_message=ERR_TYPING_ALGORITHM_FAILED,
            timeout_reason=TYPING_PHYLOLIB_ALGORITHM_TIMEOUT,
            timeout_message=ERR_TYPING_ALGORITHM_TIMEOUT,
        )

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
