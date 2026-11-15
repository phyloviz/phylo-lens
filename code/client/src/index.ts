export {
  createPhyloLensView,
  type PhyloLensAncillaryResult,
  type PhyloLensLoadOptions,
  type PhyloLensView,
  type PhyloLensViewOptions,
} from './phyloLensView';
export {
  IncompatiblePhyloLensServiceError,
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
} from './services/serviceErrors';
export { SUPPORTED_PHYLO_LENS_API_VERSION } from './services/graph/service/serviceInformation';
export { type SourceFormat } from './contracts/models';
export type { LodPreparationOptions } from './contracts/graph/LodPreparationOptions';
export type { TreeIndex } from './contracts/graph/TreeIndex';
export type { SfdpOptions } from './contracts/graph/SfdpOptions';
export type { TypingOptions } from './contracts/graph/TypingOptions';
export type { VisualMappingOptions } from './render/mapping/visualMapping';
export type { GroupSizeMappingOptions } from './render/mapping/groupSize';

export type {
  AncillaryData,
  AncillaryField,
  AncillaryType,
  AncillaryValue,
  AncillarySummary,
  AncillaryObservation,
  ProfileSummary,
  Isolate,
  NodeAnnotations,
  AncillaryTableInput,
  AncillaryDataInput,
} from './contracts/ancillary';

export type { ExpansionState, ExpansionResult } from './contracts/expansion';

export type { PieMappingOptions, PieCategoryGrouping } from './render/mapping/pieMapping.types';
export { pieDistribution } from './render/mapping/pieDistribution';

export type { DragSelection, GraphDisplayOptions, PngExportOptions } from './render/renderer.types';

export { toNodeId, toClusterId, toDatasetId, toLayoutVersion } from './contracts/graph/graphIdentifiers';
export type { NodeId, ClusterId, DatasetId, LayoutVersion } from './contracts/graph/graphIdentifiers';

export type { Point } from './contracts/Point';

export type { GraphComponent, GraphComponentsRequest, GraphComponentsResult } from './contracts/graph/components';
export type { LayoutMotionState } from './render/renderer.types';
export type { DistanceConnectionOptions } from './contracts/graph/connections';

// Backend adapter contracts. HTTP wire DTOs remain private to the default adapter.
export type * from './contracts/graph/GraphClient';
export type * from './contracts/graph/prepare/GraphPrepareRequest';
export type * from './contracts/graph/prepare/GraphPrepareResult';
export type * from './contracts/graph/prepare/GraphPrepareOptions';
export type * from './contracts/graph/prepare/GraphPrepareStatus';
export type * from './contracts/graph/prepare/GraphPrepareErrorDetails';
export type * from './contracts/graph/prepare/GraphPrepareJob';
export type * from './contracts/graph/viewport/GraphViewportRequest';
export type * from './contracts/graph/viewport/GraphViewportResult';
export type * from './contracts/graph/viewport/GraphViewportReadOptions';
export type * from './contracts/graph/viewport/GraphViewportNode';
export type * from './contracts/graph/viewport/GraphViewportEdge';
export type * from './contracts/graph/viewport/GraphLayoutBounds';
export type * from './contracts/graph/region/GraphRegionRequest';
export type * from './contracts/graph/region/GraphRegionResult';
export type * from './contracts/graph/search/GraphSearchRequest';
export type * from './contracts/graph/search/GraphSearchResult';
export type * from './contracts/graph/search/GraphSearchMatch';
export type * from './contracts/graph/ancillary/GraphAncillaryRequest';
export type * from './contracts/graph/ancillary/GraphAncillaryResult';
export { GraphLayoutStatus, GraphPrepareJobStatus } from './contracts/graph/graphTypes';
export type {
  DistanceConnection,
  DistanceConnectionsRequest,
  DistanceConnectionsResult,
} from './contracts/graph/connections';
export { createGraphClient } from './services/graph/graphService';
export type { HttpClientOptions as GraphHttpClientOptions } from './services/httpClient';
export type { GraphRootingRequest, GraphRootingResult } from './contracts/graph/rooting';
