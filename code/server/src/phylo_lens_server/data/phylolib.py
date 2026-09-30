from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from phylo_lens_server.config.settings import phylolib_timeout_seconds
from phylo_lens_server.data.parsers import ParsedEdge, ParsedGraph, parse_newick_forest
from phylo_lens_server.data.typing_profiles import (
    PreparedTypingProfiles,
    collapse_profile_graph,
    select_goeburst_root,
    validate_goeburst_tree,
)

logger = logging.getLogger(__name__)

# PhyloLib CLI (https://github.com/phyloviz/phylolib). The PhyloLens service
# image runs the bundled JAR directly; the rest of the normalization pipeline
# only deals with typing profiles and parsed Newick output.
JAVA_COMMAND = "java"
ENV_PHYLOLIB_JAR = "PHYLO_LENS_PHYLOLIB_JAR"
ENV_PHYLOLIB_JAVA = "PHYLO_LENS_PHYLOLIB_JAVA"

# Defaults: Hamming for allelic MLST, then goeBURST Full MST. Full MST uses
# every observed locus-variant level, which is appropriate for cg/wgMLST data
# and normally produces one connected spanning tree.
DEFAULT_DISTANCE_METHOD = "hamming"
GOEBURST_FULL_MST_ALGORITHM = "goeburstfullmst"
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


@dataclass(frozen=True)
class RootedTypingTree:
    parsed: ParsedGraph
    distinct: ParsedGraph
    root: str


def typing_profiles_to_rooted_tree(
    profiles: PreparedTypingProfiles,
) -> RootedTypingTree:
    """Build a Full MST and resolve its technical root from PhyloLib's matrix.

    Runs two PhyloLib stages against a temp directory: ``distance`` (profiles ->
    complete symmetric matrix) then ``algorithm goeburstfullmst`` (matrix ->
    Newick MST). Raises
    :class:`TypingNormalizeError` when no PhyloLib runtime is available or either
    stage fails.
    """
    membership = profiles.membership()
    if len(membership) == 1:
        ids = [node_id for members in membership.values() for _, node_id in members]
        parsed = ParsedGraph(
            ids,
            [ParsedEdge(ids[0], node_id, 0) for node_id in ids[1:]],
            component_roots=(ids[0],),
            explicit_node_ids=set(ids),
        )
        distinct = collapse_profile_graph(parsed, membership)
        validate_goeburst_tree(distinct, membership)
        return RootedTypingTree(parsed, distinct, next(iter(membership)))

    with tempfile.TemporaryDirectory(prefix="phylolib-") as tmp:
        files_dir = Path(tmp)
        (files_dir / PROFILES_FILENAME).write_text(
            profiles.algorithm_content(), encoding="utf-8"
        )

        profiles_path = str(files_dir / PROFILES_FILENAME)
        matrix_path = str(files_dir / MATRIX_FILENAME)
        tree_path = files_dir / TREE_FILENAME
        distance_in = f"{DATASET_FORMAT_ML}:{profiles_path}"
        matrix_ref = f"{MATRIX_FORMAT_SYMMETRIC}:{matrix_path}"
        _run_phylolib_cli(
            [
                "distance",
                DEFAULT_DISTANCE_METHOD,
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
                GOEBURST_FULL_MST_ALGORITHM,
                f"--matrix={matrix_ref}",
                f"--out={tree_ref}",
            ],
            failure_reason=TYPING_PHYLOLIB_ALGORITHM_FAILED,
            failure_message=ERR_TYPING_ALGORITHM_FAILED,
            timeout_reason=TYPING_PHYLOLIB_ALGORITHM_TIMEOUT,
            timeout_message=ERR_TYPING_ALGORITHM_TIMEOUT,
        )

        root = select_goeburst_root(Path(matrix_path), profiles, membership)

        newick = (
            tree_path.read_text(encoding="utf-8").strip() if tree_path.exists() else ""
        )

    if not newick:
        logger.warning(ERR_TYPING_EMPTY_TREE)
        raise TypingNormalizeError(
            ERR_TYPING_EMPTY_TREE, reason=TYPING_PHYLOLIB_EMPTY_TREE
        )

    parsed = parse_newick_forest(newick)
    distinct = collapse_profile_graph(parsed, membership)
    validate_goeburst_tree(distinct, membership)
    return RootedTypingTree(parsed, distinct, root)
