import type { PositionedGraph } from '../../../contracts/positioned';

/** Orient loaded canonical components from the preparation's technical roots. */
export function branchChildren(graph: PositionedGraph, roots: readonly string[]): Map<string, string[]> {
  const neighbors = new Map(graph.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    neighbors.get(edge.source)?.push(edge.target);
    neighbors.get(edge.target)?.push(edge.source);
  }
  const children = new Map<string, string[]>();
  for (const root of roots) {
    if (!neighbors.has(root)) continue;
    const parent = new Map<string, string | null>([[root, null]]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const descendants: string[] = [];
      for (const neighbor of neighbors.get(id) ?? []) {
        if (neighbor === parent.get(id)) continue;
        if (parent.has(neighbor)) throw new Error('Manual branch collapse requires an acyclic component.');
        parent.set(neighbor, id);
        descendants.push(neighbor);
        queue.push(neighbor);
      }
      children.set(id, descendants);
    }
  }
  return children;
}

export function branchDescendants(children: ReadonlyMap<string, readonly string[]>, root: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [...(children.get(root) ?? [])];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return descendants;
}

/** Manual folds keep the original node's identity and observations; only descendants are hidden. */
export function applyBranchFolds(
  graph: PositionedGraph,
  foldedRoots: ReadonlySet<string>,
  children: ReadonlyMap<string, readonly string[]>
): PositionedGraph {
  if (children.size === 0 && foldedRoots.size === 0) return graph;
  const hidden = new Set<string>();
  const counts = new Map<string, number>();
  const visibleIds = new Set(graph.nodes.map(node => node.id));
  for (const root of foldedRoots) {
    // A filtered-out marker must not make otherwise matching nodes unreachable.
    if (!visibleIds.has(root)) continue;
    const descendants = branchDescendants(children, root);
    counts.set(root, descendants.size);
    for (const id of descendants) hidden.add(id);
  }
  const nodes = graph.nodes
    .filter(node => !hidden.has(node.id))
    .map(node => {
      const count = counts.get(node.id) ?? 0;
      const attributes = {
        ...node.attributes,
        canCollapseBranch: (children.get(node.id)?.length ?? 0) > 0,
        isBranchCollapsed: count > 0,
        collapsedBranchCount: count,
        ...(count > 0
          ? {
              type: 'border',
              borderColor: '#0f766e',
              label: node.attributes?.label ? `${node.id} (+${count})` : '',
              forceLabel: Boolean(node.attributes?.label),
            }
          : {}),
      };
      return { ...node, attributes };
    });
  const ids = new Set(nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return {
    ...graph,
    nodes,
    edges,
    viewMeta: { ...graph.viewMeta, sliceNodeCount: nodes.length, sliceEdgeCount: edges.length },
  };
}
