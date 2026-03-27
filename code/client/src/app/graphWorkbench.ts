import { DatasetClient, NormalizeRequest } from "../api/datasetClient";
import { SOURCE_FORMAT_NEWICK } from "../contracts/canonical";
import { PositionedGraph } from "../contracts/positioned";
import { buildMetadataIndex } from "../ancillary/metadataIndex";
import {
  ClientGraphFilterEngine,
  EMPTY_METADATA_FILTER_STATE,
  GraphFilterEngine,
  MetadataFilterState,
} from "../ancillary/filterEngine";
import {
  buildSimpleTreeLayout,
  TreeLayoutMode,
} from "../layout/simpleTreeLayout";
import {
  applyVisualMappings,
  VisualMappingOptions,
} from "../render/visualMappings";
import {
  GraphRenderer,
  RenderContext,
  RendererFactory,
  RendererKind,
} from "../render/types";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const ERR_NO_GRAPH_RENDERED =
  "No graph has been rendered yet. Render a dataset before applying filters.";

export interface RenderNewickOptions {
  metadataSchema?: Array<{ key: string; type: string }>;
  metadataByNodeId?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  visualMapping?: VisualMappingOptions;
  layout?: {
    mode?: TreeLayoutMode;
    forceIterations?: number;
  };
}

export interface GraphWorkbenchOptions {
  datasetClient: DatasetClient;
  rendererFactory: RendererFactory;
  rendererKind: RendererKind;
  renderContext: RenderContext;
  filterEngine?: GraphFilterEngine;
}

// Orchestrate normalize -> layout -> render through modular client boundaries.
export class GraphWorkbench {
  private readonly datasetClient: DatasetClient;
  private readonly renderer: GraphRenderer;
  private readonly filterEngine: GraphFilterEngine;

  private fullGraph: PositionedGraph | null = null;
  private metadataIndex: ReturnType<typeof buildMetadataIndex> | null = null;
  private activeFilters: MetadataFilterState = EMPTY_METADATA_FILTER_STATE;

  constructor(options: GraphWorkbenchOptions) {
    this.datasetClient = options.datasetClient;
    this.filterEngine = options.filterEngine ?? new ClientGraphFilterEngine();
    this.renderer = options.rendererFactory.createRenderer(
      options.rendererKind,
    );
    this.renderer.mount(options.renderContext);
  }

  // Normalize Newick content, compute positions, and render the graph.
  async renderNewick(
    newick: string,
    datasetName = DEFAULT_DATASET_NAME,
    options: RenderNewickOptions = {},
  ): Promise<PositionedGraph> {
    const request: NormalizeRequest = {
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: datasetName,
      content: newick,
      metadata_schema: options.metadataSchema,
      metadata_by_node_id: options.metadataByNodeId,
    };

    const normalizeResponse =
      await this.datasetClient.normalizeDataset(request);
    const positionedGraph = buildSimpleTreeLayout(normalizeResponse.dataset, {
      mode: options.layout?.mode,
      forceIterations: options.layout?.forceIterations,
    });
    const metadataIndex = buildMetadataIndex(normalizeResponse.dataset);
    const mappedGraph = applyVisualMappings(
      positionedGraph,
      normalizeResponse.dataset,
      metadataIndex,
      options.visualMapping,
    );

    this.fullGraph = mappedGraph;
    this.metadataIndex = metadataIndex;
    this.activeFilters = EMPTY_METADATA_FILTER_STATE;

    this.renderer.render(mappedGraph);
    return mappedGraph;
  }

  // Apply metadata filters and re-render the current graph view.
  applyMetadataFilters(filterState: MetadataFilterState): PositionedGraph {
    if (!this.fullGraph || !this.metadataIndex) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    this.activeFilters = filterState;
    const filteredGraph = this.filterEngine.apply(
      this.fullGraph,
      this.metadataIndex,
      this.activeFilters,
    );
    this.renderer.render(filteredGraph);
    return filteredGraph;
  }

  // Clear active metadata filters and restore the complete rendered graph.
  clearMetadataFilters(): PositionedGraph {
    if (!this.fullGraph || !this.metadataIndex) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    this.activeFilters = EMPTY_METADATA_FILTER_STATE;
    this.renderer.render(this.fullGraph);
    return this.fullGraph;
  }

  // Unmount renderer resources when leaving the workbench lifecycle.
  dispose(): void {
    this.renderer.unmount();
  }
}
