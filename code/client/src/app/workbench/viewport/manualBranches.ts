import type { PositionedGraph, PositionedNode } from '../../../contracts/positioned';
import type { TreeIndex } from '../../../contracts/graph/TreeIndex';
import { MANUAL_BRANCH_COLOR } from '../../../render/mapping/clusterNodes';

type Fold = TreeIndex & { readonly rootId: string };

/**
 * Intent is keyed by canonical node, independent of viewport slices and LoD IDs.
 * DFS subtree intervals are nested or disjoint. Cache their disjoint outer cover
 * on mutation, then query it by binary search for each incoming representation.
 */
export class ManualBranches {
  private readonly intentions = new Map<string, Fold>();
  private cover: readonly Fold[] = [];

  get size(): number {
    return this.intentions.size;
  }

  clear(): void {
    this.intentions.clear();
    this.cover = [];
  }

  collapse(node: PositionedNode): boolean {
    const index = node.attributes?.treeIndex;
    if (!index || node.attributes?.isClusterProxy === true || index.end - index.start <= 1) return false;
    this.intentions.set(node.id, { ...index, rootId: node.id });
    this.rebuild();
    return true;
  }

  collapseRoots(graph: PositionedGraph): void {
    for (const node of graph.nodes) {
      const index = node.attributes?.treeIndex;
      if (index?.parentId === null && node.attributes?.isClusterProxy !== true && index.end - index.start > 1)
        this.intentions.set(node.id, { ...index, rootId: node.id });
    }
    this.rebuild();
  }

  expand(rootId: string): boolean {
    if (!this.intentions.delete(rootId)) return false;
    this.rebuild();
    return true;
  }

  /** Search reveals its target, retaining unrelated and nested descendant choices. */
  reveal(index: TreeIndex): void {
    let changed = false;
    for (const [id, fold] of this.intentions)
      if (fold.componentId === index.componentId && fold.start <= index.start && index.start < fold.end) {
        this.intentions.delete(id);
        changed = true;
      }
    if (changed) this.rebuild();
  }

  apply(graph: PositionedGraph): PositionedGraph {
    const nodes: PositionedNode[] = [];
    for (const node of graph.nodes) {
      const index = node.attributes?.treeIndex;
      const fold = index ? this.containing(index.start) : undefined;
      if (fold && index && fold.start < index.start && index.start < fold.end) continue;
      // A coarser aggregate may subsume a manual choice. Retain its normal LoD
      // appearance; the choice becomes visible again when that tier is refined.
      const ordinary = node.attributes?.isClusterProxy !== true;
      const count = ordinary && fold?.rootId === node.id ? fold.end - fold.start - 1 : 0;
      nodes.push({
        ...node,
        attributes: {
          ...node.attributes,
          canCollapseBranch: ordinary && index !== undefined && index.end - index.start > 1,
          isBranchCollapsed: count > 0,
          collapsedBranchCount: count,
          ...(count > 0
            ? {
                type: 'triangle',
                color: MANUAL_BRANCH_COLOR,
                triangleRotation: 0,
                label: node.attributes?.label ? `${node.id} (+${count})` : '',
                forceLabel: Boolean(node.attributes?.label),
              }
            : {}),
        },
      });
    }
    const ids = new Set(nodes.map(node => node.id));
    const edges = graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    return {
      ...graph,
      nodes,
      edges,
      viewMeta: { ...graph.viewMeta, sliceNodeCount: nodes.length, sliceEdgeCount: edges.length },
    };
  }

  private rebuild(): void {
    const sorted = [...this.intentions.values()].sort((a, b) => a.start - b.start);
    const cover: Fold[] = [];
    for (const fold of sorted) {
      const previous = cover[cover.length - 1];
      if (!previous || fold.start >= previous.end) cover.push(fold);
    }
    this.cover = cover;
  }

  private containing(start: number): Fold | undefined {
    let low = 0;
    let high = this.cover.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.cover[middle].start <= start) low = middle + 1;
      else high = middle;
    }
    return low > 0 ? this.cover[low - 1] : undefined;
  }
}
