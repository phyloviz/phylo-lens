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
TOKEN_COMMENT_OPEN = "["
TOKEN_COMMENT_CLOSE = "]"
TOKEN_QUOTE = "'"

NODE_PREFIX_LEAF = "leaf"
NODE_PREFIX_UNION = "union"

ERR_NEWICK_EMPTY = "Newick content is empty."
ERR_NEWICK_TRAILING_CONTENT = "Unexpected content after Newick tree terminator."
ERR_NEWICK_MISSING_CLOSE = "Missing ')' in Newick content."
ERR_NEWICK_BRANCH_LENGTH = "Invalid Newick branch length near index {index}."
ERR_NEWICK_COMMENT = "Unterminated Newick comment near index {index}."
ERR_NEWICK_QUOTED_LABEL = "Unterminated quoted Newick label near index {index}."
WARN_DUPLICATE_LABEL = (
    "Label '{label}' is duplicated, generated deterministic suffix for uniqueness."
)
WARN_NEWICK_EMPTY_CHILD = (
    "Ignored empty child position in Newick content near index {index}."
)
# A Newick file may contain several ``;``-terminated trees (a forest); goeBURST
# output is routinely disconnected (distant STs never join the MST), so a
# precomputed .nwk is often a forest with many single-node components. We parse
# each independently and merge into one disconnected graph, preserving true
# topology (no synthetic root).
WARN_NEWICK_FOREST = (
    "Newick input contains {count} disconnected components; kept as a forest."
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
class _PendingUnionNode:
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
    union_counter = 0
    warnings: list[str] = []

    nodes: list[str] = []
    edges: list[tuple[str, str]] = []
    explicit_node_ids: set[str] = set()
    stack: list[_PendingUnionNode] = []
    root_id: str | None = None
    expect_subtree = True

    def assign_id(label: str | None, prefix: str, counter: int) -> tuple[str, bool]:
        """Build a deterministic node id from label or generated prefix.

        Returns the id and whether a meaningful (non-empty) label slug was used.
        A label like ``_`` slugifies to an empty string and is treated as an
        anonymous junction, so it does not count as an explicit label.
        """
        used_slug = False
        if label:
            slug = slugify_label(label)
            if slug:
                base = slug
                used_slug = True
            else:
                base = f"{prefix}_{counter}"
        else:
            base = f"{prefix}_{counter}"

        if base in used_ids:
            used_ids[base] += 1
            if used_slug:
                warnings.append(WARN_DUPLICATE_LABEL.format(label=label))
            return f"{base}_{used_ids[base]}", used_slug

        used_ids[base] = 1
        return base, used_slug

    def peek() -> str | None:
        if index >= content_length:
            return None
        return content[index]

    def consume_ignored() -> None:
        nonlocal index
        while index < content_length:
            if content[index].isspace():
                index += 1
                continue
            if content[index] == TOKEN_COMMENT_OPEN:
                consume_comment()
                continue
            break

    def consume_comment() -> None:
        nonlocal index
        start = index
        index += 1
        while index < content_length and content[index] != TOKEN_COMMENT_CLOSE:
            index += 1
        if index >= content_length:
            raise ParseError(ERR_NEWICK_COMMENT.format(index=start))
        index += 1

    def parse_quoted_label() -> str:
        nonlocal index
        start = index
        index += 1
        chunks: list[str] = []
        while index < content_length:
            current = content[index]
            if current != TOKEN_QUOTE:
                chunks.append(current)
                index += 1
                continue
            if index + 1 < content_length and content[index + 1] == TOKEN_QUOTE:
                chunks.append(TOKEN_QUOTE)
                index += 2
                continue
            index += 1
            return "".join(chunks)
        raise ParseError(ERR_NEWICK_QUOTED_LABEL.format(index=start))

    def parse_label_optional() -> str | None:
        nonlocal index
        consume_ignored()
        if peek() == TOKEN_QUOTE:
            return parse_quoted_label()
        start = index
        while index < content_length and content[index] not in (
            TOKEN_COMMA
            + TOKEN_OPEN_PAREN
            + TOKEN_CLOSE_PAREN
            + TOKEN_COLON
            + TOKEN_TERMINATOR
            + TOKEN_COMMENT_OPEN
        ):
            index += 1
        label = content[start:index].strip()
        return label or None

    def parse_branch_length_optional() -> float | None:
        nonlocal index
        consume_ignored()
        if peek() != TOKEN_COLON:
            return None
        index += 1
        start = index
        while index < content_length and content[index] not in (
            TOKEN_COMMA
            + TOKEN_OPEN_PAREN
            + TOKEN_CLOSE_PAREN
            + TOKEN_TERMINATOR
            + TOKEN_COMMENT_OPEN
        ):
            index += 1
        raw_value = content[start:index].strip()
        if not raw_value:
            raise ParseError(ERR_NEWICK_BRANCH_LENGTH.format(index=start))
        try:
            branch_length = float(raw_value)
        except ValueError as exc:
            raise ParseError(ERR_NEWICK_BRANCH_LENGTH.format(index=start)) from exc
        consume_ignored()
        return branch_length

    def emit_completed_node(node_id: str, distance_to_parent: float | None) -> None:
        nonlocal root_id
        if stack:
            stack[-1].child_links.append((node_id, distance_to_parent))
            return
        if root_id is not None:
            raise ParseError(ERR_NEWICK_TRAILING_CONTENT)
        root_id = node_id

    while True:
        consume_ignored()
        current = peek()

        if expect_subtree:
            if current is None:
                if stack:
                    raise ParseError(ERR_NEWICK_MISSING_CLOSE)
                break

            if current == TOKEN_OPEN_PAREN:
                union_counter += 1
                stack.append(_PendingUnionNode(preorder_index=union_counter))
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
                # A trailing separator before ')' (e.g. "(A,B,)") is a benign
                # phylolib dialect quirk, not an empty child. Only warn when the
                # group has no children at all (a genuinely empty "()").
                if not stack[-1].child_links:
                    warnings.append(WARN_NEWICK_EMPTY_CHILD.format(index=index))
                expect_subtree = False
                continue

            leaf_counter += 1
            label = parse_label_optional()
            branch_length = parse_branch_length_optional()
            node_id, used_slug = assign_id(label, NODE_PREFIX_LEAF, leaf_counter)
            nodes.append(node_id)
            if used_slug:
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
            node_id, used_slug = assign_id(
                label, NODE_PREFIX_UNION, pending.preorder_index
            )
            nodes.append(node_id)
            if used_slug:
                explicit_node_ids.add(node_id)
            for child_id, child_distance in pending.child_links:
                edges.append(
                    ParsedEdge(source=node_id, target=child_id, distance=child_distance)
                )
            emit_completed_node(node_id, branch_length)
            continue

        if current == TOKEN_TERMINATOR:
            if stack:
                raise ParseError(ERR_NEWICK_MISSING_CLOSE)
            index += 1
            consume_ignored()
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


def _split_forest(content: str) -> list[str]:
    """Split Newick text into individual ``;``-terminated trees."""
    trees: list[str] = []
    start = 0
    index = 0
    content_length = len(content)
    in_quote = False
    in_comment = False

    while index < content_length:
        current = content[index]

        if in_comment:
            if current == TOKEN_COMMENT_CLOSE:
                in_comment = False
            index += 1
            continue

        if in_quote:
            if current == TOKEN_QUOTE:
                if index + 1 < content_length and content[index + 1] == TOKEN_QUOTE:
                    index += 2
                    continue
                in_quote = False
            index += 1
            continue

        if current == TOKEN_COMMENT_OPEN:
            in_comment = True
            index += 1
            continue

        if current == TOKEN_QUOTE:
            in_quote = True
            index += 1
            continue

        if current == TOKEN_TERMINATOR:
            tree = content[start : index + 1].strip()
            if tree:
                trees.append(tree)
            start = index + 1

        index += 1

    tail = content[start:].strip()
    if tail:
        trees.append(f"{tail}{TOKEN_TERMINATOR}")
    return trees


def _merge_parsed_forest(graphs: list[ParsedGraph]) -> ParsedGraph:
    """Merge per-component graphs into one disconnected graph without a root.

    Each component is parsed independently, so ``parse_newick`` restarts its
    generated-id counters (``leaf_N`` / ``union_N``) per component and would
    collide across components. We namespace generated ids with a per-component
    prefix while leaving explicit labels untouched, preserving true topology.
    """
    nodes: list[str] = []
    edges: list[ParsedEdge] = []
    warnings: list[str] = []
    explicit_node_ids: set[str] = set()

    for component_index, graph in enumerate(graphs):
        remap: dict[str, str] = {}
        for node_id in graph.nodes:
            if node_id in graph.explicit_node_ids:
                remap[node_id] = node_id
            else:
                remap[node_id] = f"c{component_index}_{node_id}"
        nodes.extend(remap[node_id] for node_id in graph.nodes)
        explicit_node_ids.update(remap[node_id] for node_id in graph.explicit_node_ids)
        edges.extend(
            ParsedEdge(
                source=remap[edge.source],
                target=remap[edge.target],
                distance=edge.distance,
            )
            for edge in graph.edges
        )
        warnings.extend(graph.warnings)

    return ParsedGraph(
        nodes=nodes,
        edges=edges,
        warnings=warnings,
        explicit_node_ids=explicit_node_ids,
    )


def parse_newick_forest(content: str) -> ParsedGraph:
    """Parse Newick text that may hold one tree or a ``;``-separated forest.

    A single tree flows through unchanged; multiple ``;``-terminated components
    are parsed independently and merged into one disconnected ParsedGraph.
    Downstream clustering already partitions by connected component, so a forest
    flows through unchanged.
    """
    trees = _split_forest(content)
    if not trees:
        # Defer to the single-tree parser so the empty-content error is raised
        # with the same message as a direct parse_newick call.
        return parse_newick(content)

    graphs = [parse_newick(tree) for tree in trees]
    if len(graphs) == 1:
        return graphs[0]

    merged = _merge_parsed_forest(graphs)
    merged.warnings.append(WARN_NEWICK_FOREST.format(count=len(graphs)))
    return merged


def slugify_label(label: str) -> str:
    """Match Newick label normalization for external node metadata joins."""
    return (
        LABEL_SLUG_PATTERN.sub(LABEL_SLUG_REPLACEMENT, label)
        .strip(LABEL_SLUG_STRIP_CHARS)
        .lower()
    )
