import { describe, expect, it } from 'vitest';
import { ManualBranches } from '../src/app/workbench/viewport/manualBranches';
import type { PositionedGraph, PositionedNode } from '../src/contracts/positioned';

function node(id: string, start: number, end: number, parentId: string | null = 'root', proxy = false): PositionedNode {
  return {
    id,
    x: start,
    y: 0,
    attributes: {
      label: id,
      isClusterProxy: proxy,
      treeIndex: { componentId: 'root', parentId, depth: parentId ? 1 : 0, start, end },
    },
  };
}
function graph(nodes: readonly PositionedNode[]): PositionedGraph {
  return {
    nodes,
    edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
    viewMeta: { layout: 'server', lodLevel: 0 },
  };
}

describe('ManualBranches', () => {
  it('retains nested intentions and computes the full subtree count from a partial slice', () => {
    const folds = new ManualBranches();
    const root = node('root', 0, 100, null);
    const inner = node('inner', 10, 40);
    folds.collapse(inner);
    folds.collapse(root);
    expect(folds.apply(graph([root, inner, node('leaf', 20, 21)])).nodes.map(n => n.id)).toEqual(['root']);
    expect(folds.apply(graph([root])).nodes[0].attributes?.collapsedBranchCount).toBe(99);
    folds.expand('root');
    expect(folds.apply(graph([inner, node('leaf', 20, 21)])).nodes.map(n => n.id)).toEqual(['inner']);
    expect(folds.size).toBe(1);
  });

  it('keeps an intent latent beneath a coarser aggregate and reapplies it after refinement', () => {
    const folds = new ManualBranches();
    const inner = node('inner', 10, 40);
    folds.collapse(inner);
    const coarse = node('ancestor', 5, 80, 'root', true);
    expect(folds.apply(graph([coarse])).nodes[0].attributes?.isBranchCollapsed).toBe(false);
    expect(folds.size).toBe(1);
    expect(folds.apply(graph([inner, node('leaf', 20, 21)])).nodes.map(n => n.id)).toEqual(['inner']);
  });

  it('hides streamed descendants even when the marker is outside the viewport', () => {
    const folds = new ManualBranches();
    folds.collapse(node('inner', 10, 40));
    expect(folds.apply(graph([node('leaf', 20, 21), node('outside', 50, 51)])).nodes.map(n => n.id)).toEqual([
      'outside',
    ]);
  });

  it('search reveals containing folds and retains unrelated choices', () => {
    const folds = new ManualBranches();
    const root = node('root', 0, 100, null);
    const inner = node('inner', 10, 40);
    const other = node('other', 50, 80);
    for (const n of [root, inner, other]) folds.collapse(n);
    folds.reveal(node('target', 20, 21).attributes!.treeIndex!);
    expect(folds.size).toBe(1);
    const result = folds.apply(graph([root, inner, node('target', 20, 21), other, node('other-leaf', 60, 61)]));
    expect(result.nodes.map(n => n.id)).toEqual(['root', 'inner', 'target', 'other']);
    expect(
      result.edges.every(
        edge => result.nodes.some(n => n.id === edge.source) && result.nodes.some(n => n.id === edge.target)
      )
    ).toBe(true);
  });

  it('batch collapses many independent roots with one read per node', () => {
    const folds = new ManualBranches();
    let reads = 0;
    const nodes = Array.from({ length: 10000 }, (_, i) => {
      const root = node(`r${i}`, 2 * i, 2 * i + 2, null);
      return {
        ...root,
        attributes: {
          ...root.attributes,
          get treeIndex() {
            reads++;
            return root.attributes!.treeIndex;
          },
        },
      };
    });
    folds.collapseRoots(graph(nodes));
    expect(reads).toBe(nodes.length);
    expect(folds.size).toBe(nodes.length);
    expect(folds.apply(graph(nodes)).nodes).toHaveLength(nodes.length);
    expect(reads).toBe(3 * nodes.length); // application reads the index and copies attributes
  });

  it('matches a simple containment oracle for arbitrary nested and disjoint folds', () => {
    const nodes = Array.from({ length: 127 }, (_, i) => {
      // Complete binary tree in heap order, with independently assigned preorder intervals.
      return { id: String(i), children: [2 * i + 1, 2 * i + 2].filter(c => c < 127), start: 0, end: 0 };
    });
    let cursor = 0;
    function visit(i: number): void {
      nodes[i].start = cursor++;
      for (const c of nodes[i].children) visit(c);
      nodes[i].end = cursor;
    }
    visit(0);
    const positioned = nodes.map(n =>
      node(n.id, n.start, n.end, n.id === '0' ? null : String(Math.floor((Number(n.id) - 1) / 2)))
    );
    const folds = new ManualBranches();
    const chosen = positioned.filter(
      (n, i) => i % 3 === 1 && n.attributes!.treeIndex!.end - n.attributes!.treeIndex!.start > 1
    );
    for (const n of chosen) folds.collapse(n);
    const expected = positioned
      .filter(
        n =>
          !chosen.some(f => {
            const a = f.attributes!.treeIndex!;
            const b = n.attributes!.treeIndex!;
            return a.start < b.start && b.start < a.end;
          })
      )
      .map(n => n.id);
    expect(folds.apply(graph(positioned)).nodes.map(n => n.id)).toEqual(expected);
  });
});
