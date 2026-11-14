import type { DistanceConnectionsResult } from '../../../contracts/graph/connections';
import type { PositionedEdge, PositionedGraph } from '../../../contracts/positioned';
import { DISTANCE_CONNECTION_COLOR } from '../../../render/mapping/distanceConnections';

/** Index once per Apply; camera updates inspect only loaded sources' links. */
export class DistanceConnectionOverlay {
  private readonly bySource = new Map<string, PositionedEdge[]>();
  private readonly connections: DistanceConnectionsResult;

  constructor(connections: DistanceConnectionsResult) {
    this.connections = connections;
    for (const edge of connections.edges) {
      const links = this.bySource.get(edge.source) ?? [];
      links.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        attributes: {
          distance: edge.distance,
          color: DISTANCE_CONNECTION_COLOR,
          size: 1,
          isDistanceConnection: true,
          label: '',
          forceLabel: false,
        },
      });
      this.bySource.set(edge.source, links);
    }
  }

  apply(graph: PositionedGraph): PositionedGraph {
    const nodes = new Map(
      graph.nodes
        .filter(node => node.attributes?.isClusterProxy !== true && node.attributes?.isBranchCollapsed !== true)
        .map(node => [node.id, node])
    );
    const extra: PositionedEdge[] = [];
    for (const source of nodes.values()) {
      for (const edge of this.bySource.get(source.id) ?? []) {
        const target = nodes.get(edge.target);
        const a = source.attributes?.treeIndex;
        const b = target?.attributes?.treeIndex;
        if (target && a && b && a.componentId === b.componentId) extra.push(edge);
      }
    }
    return {
      ...graph,
      edges: [...graph.edges, ...extra],
      viewMeta: {
        ...graph.viewMeta,
        distanceConnections: {
          metric: this.connections.metric,
          threshold: this.connections.threshold,
          totalCount: this.connections.edges.length,
          visibleCount: extra.length,
        },
      },
    };
  }
}
