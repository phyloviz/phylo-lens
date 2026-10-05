// Compile-time regression checks; npm test type-checks these before running Vitest.
import type { PositionedGraph } from '../src/contracts/positioned';
import type { GraphClient } from '../src/contracts/graph/GraphClient';
import type { VisualMappingOptions } from '../src/render/mapping/visualMapping';
import type { Point } from '../src/render/adapters/sigma/motion/displayPositions';
import type { AncillaryFilterState } from '../src/ancillary/ancillaryTypes';

declare const graph: PositionedGraph;
declare const mapping: VisualMappingOptions;
declare const filters: AncillaryFilterState;
declare const point: Point;
declare const client: GraphClient;

// @ts-expect-error Published graph collections are readonly.
graph.nodes.push({ id: 'a', x: 0, y: 0 });
// @ts-expect-error Node positions are not mutable simulation particles.
graph.nodes[0].x = 1;
// @ts-expect-error Known ancillary values remain readonly inside attributes.
graph.nodes[0].attributes!.annotations!.ancillaryData.country = 'changed';
// @ts-expect-error Nested mapping arrays are readonly too.
mapping.pie!.fields!.push('year');
// @ts-expect-error Category color dictionaries are readonly.
mapping.pie!.categoryColors!.PT = '#ffffff';
// @ts-expect-error Accepted filter values are readonly.
filters.categorical[0].acceptedValues.push('FR');
// @ts-expect-error Renderer coordinate values are readonly.
point.x = 900;
// @ts-expect-error A DTO cannot be passed to the application-facing client.
client.prepareGraph({ format: 'newick', dataset_name: 'tree', content: 'A;' });
