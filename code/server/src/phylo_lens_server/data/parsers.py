from __future__ import annotations

import re
from dataclasses import dataclass, field

LABEL_SLUG_REGEX = r"[^a-zA-Z0-9_]+"
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
ERR_EDGELIST_EMPTY = "Edge-list content is empty."
ERR_EDGELIST_ROW_COLUMNS = "Edge-list row {index} must have at least two columns."
ERR_EDGELIST_ROW_EMPTY = "Edge-list row {index} has empty source or target."
WARN_DUPLICATE_LABEL = (
    "Label '{label}' is duplicated, generated deterministic suffix for uniqueness."
)


class ParseError(ValueError):
    pass


@dataclass
class ParsedGraph:
    nodes: list[str]
    edges: list[tuple[str, str]]
    warnings: list[str] = field(default_factory=list)


@dataclass
class _TreeNode:
    label: str | None
    children: list["_TreeNode"] = field(default_factory=list)


class _NewickParser:
    """Parse raw Newick content into an in-memory tree representation."""

    def __init__(self, content: str) -> None:
        self.content = content.strip()
        self.index = 0

    def parse(self) -> _TreeNode:
        """Parse a full Newick document and enforce complete consumption."""
        if not self.content:
            raise ParseError(ERR_NEWICK_EMPTY)

        root = self._parse_subtree()
        self._consume_whitespace()
        if self._peek() == TOKEN_TERMINATOR:
            self.index += 1
        self._consume_whitespace()
        if self.index != len(self.content):
            raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
        return root

    def _parse_subtree(self) -> _TreeNode:
        """Parse one Newick subtree, including optional label and branch length."""
        self._consume_whitespace()
        if self._peek() == TOKEN_OPEN_PAREN:
            self.index += 1
            children = [self._parse_subtree()]
            self._consume_whitespace()
            while self._peek() == TOKEN_COMMA:
                self.index += 1
                children.append(self._parse_subtree())
                self._consume_whitespace()
            if self._peek() != TOKEN_CLOSE_PAREN:
                raise ParseError(ERR_NEWICK_MISSING_CLOSE)
            self.index += 1
            label = self._parse_label_optional()
            self._parse_branch_length_optional()
            return _TreeNode(label=label, children=children)

        label = self._parse_label_optional()
        self._parse_branch_length_optional()
        return _TreeNode(label=label, children=[])

    def _parse_label_optional(self) -> str | None:
        """Read an optional node label stopping at Newick control tokens."""
        self._consume_whitespace()
        start = self.index
        while self.index < len(self.content) and self.content[self.index] not in (
            TOKEN_COMMA
            + TOKEN_OPEN_PAREN
            + TOKEN_CLOSE_PAREN
            + TOKEN_COLON
            + TOKEN_TERMINATOR
        ):
            self.index += 1
        label = self.content[start : self.index].strip()
        return label or None

    def _parse_branch_length_optional(self) -> None:
        """Skip branch-length tokens because current contracts do not persist them."""
        self._consume_whitespace()
        if self._peek() != TOKEN_COLON:
            return
        self.index += 1
        while self.index < len(self.content) and self.content[self.index] not in (
            TOKEN_COMMA + TOKEN_OPEN_PAREN + TOKEN_CLOSE_PAREN + TOKEN_TERMINATOR
        ):
            self.index += 1

    def _consume_whitespace(self) -> None:
        """Advance cursor over any whitespace characters."""
        while self.index < len(self.content) and self.content[self.index].isspace():
            self.index += 1

    def _peek(self) -> str | None:
        """Return the current character without consuming it."""
        if self.index >= len(self.content):
            return None
        return self.content[self.index]


def parse_newick(content: str) -> ParsedGraph:
    """Parse Newick text into node and edge lists with stable generated identifiers."""
    parser = _NewickParser(content)
    root = parser.parse()

    used_ids: dict[str, int] = {}
    leaf_counter = 0
    internal_counter = 0
    warnings: list[str] = []

    nodes: list[str] = []
    edges: list[tuple[str, str]] = []

    def assign_id(label: str | None, prefix: str, counter: int) -> str:
        """Build a deterministic node id from label or generated prefix."""
        if label:
            slug = (
                re.sub(LABEL_SLUG_REGEX, LABEL_SLUG_REPLACEMENT, label)
                .strip(LABEL_SLUG_STRIP_CHARS)
                .lower()
            )
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

    def visit(node: _TreeNode) -> str:
        """Traverse the parsed tree depth-first and materialize node-edge lists."""
        nonlocal leaf_counter, internal_counter
        if not node.children:
            leaf_counter += 1
            node_id = assign_id(node.label, NODE_PREFIX_LEAF, leaf_counter)
            nodes.append(node_id)
            return node_id

        internal_counter += 1
        node_id = assign_id(node.label, NODE_PREFIX_INTERNAL, internal_counter)
        nodes.append(node_id)
        for child in node.children:
            child_id = visit(child)
            edges.append((node_id, child_id))
        return node_id

    visit(root)
    return ParsedGraph(nodes=nodes, edges=edges, warnings=warnings)


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
    edges: list[tuple[str, str]] = []

    for index, row in enumerate(rows, start=1):
        if len(row) < 2:
            raise ParseError(ERR_EDGELIST_ROW_COLUMNS.format(index=index))
        source = row[0].strip()
        target = row[1].strip()
        if not source or not target:
            raise ParseError(ERR_EDGELIST_ROW_EMPTY.format(index=index))
        nodes.add(source)
        nodes.add(target)
        edges.append((source, target))

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
