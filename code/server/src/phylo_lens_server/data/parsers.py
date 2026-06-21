from __future__ import annotations

import re
from dataclasses import dataclass, field

LABEL_SLUG_REGEX = r"[^a-zA-Z0-9_]+"
LABEL_SLUG_PATTERN = re.compile(LABEL_SLUG_REGEX)
LABEL_SLUG_REPLACEMENT = "_"
LABEL_SLUG_STRIP_CHARS = "_"

TOKEN_OPEN_PAREN = "("
TOKEN_CLOSE_PAREN = ")"
TOKEN_COMMA = ","
TOKEN_COLON = ":"
TOKEN_TERMINATOR = ";"

DELIMITER_TAB = "\t"
DELIMITER_COMMA = ","
DELIMITER_SPACE = " "
LINE_COMMENT_PREFIX = "#"
WHITESPACE_SPLIT_REGEX = r"\s+"

HEADER_SOURCE = "source"
HEADER_FROM = "from"
HEADER_TARGET = "target"
HEADER_TO = "to"

NODE_PREFIX_LEAF = "leaf"
NODE_PREFIX_INTERNAL = "internal"

ERR_NEWICK_EMPTY = "Newick content is empty."
ERR_NEWICK_TRAILING_CONTENT = "Unexpected content after Newick tree terminator."
ERR_NEWICK_MISSING_CLOSE = "Missing ')' in Newick content."
ERR_NEWICK_BRANCH_LENGTH = "Invalid Newick branch length near index {index}."
ERR_EDGELIST_EMPTY = "Edge-list content is empty."
ERR_EDGELIST_ROW_COLUMNS = "Edge-list row {index} must have at least two columns."
ERR_EDGELIST_ROW_EMPTY = "Edge-list row {index} has empty source or target."
ERR_EDGELIST_ROW_DISTANCE = "Edge-list row {index} has invalid distance value."
WARN_DUPLICATE_LABEL = (
    "Label '{label}' is duplicated, generated deterministic suffix for uniqueness."
)
WARN_NEWICK_EMPTY_CHILD = (
    "Ignored empty child position in Newick content near index {index}."
)


class ParseError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedEdge:
    source: str
    target: str
    distance: float | None = None


@dataclass
class ParsedGraph:
    nodes: list[str]
    edges: list[ParsedEdge]
    warnings: list[str] = field(default_factory=list)
    explicit_node_ids: set[str] = field(default_factory=set)


@dataclass
class _PendingInternalNode:
    preorder_index: int
    child_links: list[tuple[str, float | None]] = field(default_factory=list)


def parse_newick(content: str) -> ParsedGraph:
    """Parse Newick text into node and edge lists with stable generated identifiers."""
    content = content.strip()
    if not content:
        raise ParseError(ERR_NEWICK_EMPTY)

    index = 0
    content_length = len(content)

    used_ids: dict[str, int] = {}
    leaf_counter = 0
    internal_counter = 0
    warnings: list[str] = []

    nodes: list[str] = []
    edges: list[tuple[str, str]] = []
    explicit_node_ids: set[str] = set()
    stack: list[_PendingInternalNode] = []
    root_id: str | None = None
    expect_subtree = True

    def assign_id(label: str | None, prefix: str, counter: int) -> str:
        """Build a deterministic node id from label or generated prefix."""
        if label:
            slug = slugify_label(label)
            base = slug or f"{prefix}_{counter}"
        else:
            base = f"{prefix}_{counter}"

        if base in used_ids:
            used_ids[base] += 1
            if label:
                warnings.append(WARN_DUPLICATE_LABEL.format(label=label))
            return f"{base}_{used_ids[base]}"

        used_ids[base] = 1
        return base

    def peek() -> str | None:
        if index >= content_length:
            return None
        return content[index]

    def consume_whitespace() -> None:
        nonlocal index
        while index < content_length and content[index].isspace():
            index += 1

    def parse_label_optional() -> str | None:
        nonlocal index
        consume_whitespace()
        start = index
        while index < content_length and content[index] not in (
            TOKEN_COMMA
            + TOKEN_OPEN_PAREN
            + TOKEN_CLOSE_PAREN
            + TOKEN_COLON
            + TOKEN_TERMINATOR
        ):
            index += 1
        label = content[start:index].strip()
        return label or None

    def parse_branch_length_optional() -> float | None:
        nonlocal index
        consume_whitespace()
        if peek() != TOKEN_COLON:
            return None
        index += 1
        start = index
        while index < content_length and content[index] not in (
            TOKEN_COMMA + TOKEN_OPEN_PAREN + TOKEN_CLOSE_PAREN + TOKEN_TERMINATOR
        ):
            index += 1
        raw_value = content[start:index].strip()
        if not raw_value:
            raise ParseError(ERR_NEWICK_BRANCH_LENGTH.format(index=start))
        try:
            return float(raw_value)
        except ValueError as exc:
            raise ParseError(ERR_NEWICK_BRANCH_LENGTH.format(index=start)) from exc

    def emit_completed_node(node_id: str, distance_to_parent: float | None) -> None:
        nonlocal root_id
        if stack:
            stack[-1].child_links.append((node_id, distance_to_parent))
            return
        if root_id is not None:
            raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
        root_id = node_id

    while True:
        consume_whitespace()
        current = peek()

        if expect_subtree:
            if current is None:
                if stack:
                    raise ParseError(ERR_NEWICK_MISSING_CLOSE)
                break

            if current == TOKEN_OPEN_PAREN:
                internal_counter += 1
                stack.append(_PendingInternalNode(preorder_index=internal_counter))
                index += 1
                continue

            if current == TOKEN_COMMA:
                if not stack:
                    raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
                warnings.append(WARN_NEWICK_EMPTY_CHILD.format(index=index))
                index += 1
                continue

            if current == TOKEN_CLOSE_PAREN:
                if not stack:
                    raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
                warnings.append(WARN_NEWICK_EMPTY_CHILD.format(index=index))
                expect_subtree = False
                continue

            leaf_counter += 1
            label = parse_label_optional()
            branch_length = parse_branch_length_optional()
            node_id = assign_id(label, NODE_PREFIX_LEAF, leaf_counter)
            nodes.append(node_id)
            if label is not None:
                explicit_node_ids.add(node_id)
            emit_completed_node(node_id, branch_length)
            expect_subtree = False
            continue

        if current == TOKEN_COMMA:
            if not stack:
                raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
            index += 1
            expect_subtree = True
            continue

        if current == TOKEN_CLOSE_PAREN:
            if not stack:
                raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
            index += 1
            pending = stack.pop()
            label = parse_label_optional()
            branch_length = parse_branch_length_optional()
            node_id = assign_id(label, NODE_PREFIX_INTERNAL, pending.preorder_index)
            nodes.append(node_id)
            if label is not None:
                explicit_node_ids.add(node_id)
            for child_id, child_distance in pending.child_links:
                source, target = sorted((node_id, child_id))
                edges.append(
                    ParsedEdge(source=source, target=target, distance=child_distance)
                )
            emit_completed_node(node_id, branch_length)
            continue

        if current == TOKEN_TERMINATOR:
            if stack:
                raise ParseError(ERR_NEWICK_MISSING_CLOSE)
            index += 1
            consume_whitespace()
            if index != content_length:
                raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
            break

        if current is None:
            if stack:
                raise ParseError(ERR_NEWICK_MISSING_CLOSE)
            break

        raise ParseError(ERR_NEWICK_TRAILING_CONTENT)

    return ParsedGraph(
        nodes=nodes,
        edges=edges,
        warnings=warnings,
        explicit_node_ids=explicit_node_ids,
    )


def slugify_label(label: str) -> str:
    """Match Newick label normalization for external node metadata joins."""
    return (
        LABEL_SLUG_PATTERN.sub(LABEL_SLUG_REPLACEMENT, label)
        .strip(LABEL_SLUG_STRIP_CHARS)
        .lower()
    )


def parse_edgelist(content: str) -> ParsedGraph:
    """Parse edge-list text into canonical source-target tuples."""
    raw_lines = [line.strip() for line in content.splitlines() if line.strip()]
    lines = [line for line in raw_lines if not line.startswith(LINE_COMMENT_PREFIX)]
    if not lines:
        raise ParseError(ERR_EDGELIST_EMPTY)

    delimiter = _detect_delimiter(lines[0])
    rows = [_split_line(line, delimiter) for line in lines]

    first = [item.strip().lower() for item in rows[0]]
    has_header = (
        len(first) >= 2
        and first[0] in {HEADER_SOURCE, HEADER_FROM}
        and first[1]
        in {
            HEADER_TARGET,
            HEADER_TO,
        }
    )
    if has_header:
        rows = rows[1:]

    nodes: set[str] = set()
    edges: list[ParsedEdge] = []

    for index, row in enumerate(rows, start=1):
        if len(row) < 2:
            raise ParseError(ERR_EDGELIST_ROW_COLUMNS.format(index=index))
        source = row[0].strip()
        target = row[1].strip()
        if not source or not target:
            raise ParseError(ERR_EDGELIST_ROW_EMPTY.format(index=index))
        distance: float | None = None
        if len(row) >= 3 and row[2].strip():
            try:
                distance = float(row[2].strip())
            except ValueError as exc:
                raise ParseError(ERR_EDGELIST_ROW_DISTANCE.format(index=index)) from exc
        nodes.add(source)
        nodes.add(target)
        edges.append(ParsedEdge(source=source, target=target, distance=distance))

    return ParsedGraph(nodes=sorted(nodes), edges=edges, warnings=[])


def _detect_delimiter(line: str) -> str:
    """Pick a delimiter based on first-row content heuristics."""
    if DELIMITER_TAB in line:
        return DELIMITER_TAB
    if DELIMITER_COMMA in line:
        return DELIMITER_COMMA
    return DELIMITER_SPACE


def _split_line(line: str, delimiter: str) -> list[str]:
    """Split one edge-list row into normalized columns."""
    if delimiter == DELIMITER_SPACE:
        return [part for part in re.split(WHITESPACE_SPLIT_REGEX, line.strip()) if part]
    return [part.strip() for part in line.split(delimiter)]
