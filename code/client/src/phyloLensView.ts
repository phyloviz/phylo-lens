import { createGraphClient } from "./api/graphClient";
import { SOURCE_FORMAT_NEWICK, type MetadataField, type SourceFormat, type Viewport } from "./contracts/models";
import rendererFactory from "./render/rendererFactory";
import { RENDERER_KIND_SIGMA } from "./render/renderer.types";
import type { VisualMappingOptions } from "./render/mapping/visualMapping";
import {
  createGraphWorkbench,
  ERR_GRAPH_LOAD_SUPERSEDED,
  type GraphWorkbench,
  type RenderNewickOptions,
} from "./app/workbench/graphWorkbench";
import type { GraphWorkbenchOptions } from "./app/workbench/graphWorkbench.types";
import { snapshotAppliedObserverForContainer } from "./app/workbench/internalSnapshotObserver";

export const ERR_PHYLO_LENS_VIEW_DISPOSED = "PhyloLens view has been disposed.";

export interface PhyloLensViewOptions {
  container: HTMLElement;
  apiUrl: string;
}

export interface PhyloLensLoadOptions {
  content: string;
  name?: string;
  sourceFormat?: SourceFormat;
  metadataSchema?: MetadataField[];
  metadataByNodeId?: Record<string, Record<string, string | number | boolean | null>>;
  ancillaryData?: {
    format: "auto" | "csv" | "tsv";
    content: string;
    join_column: string;
  };
  visualMapping?: VisualMappingOptions;
  layout?: {
    forceIterations?: number;
  };
  lod?: {
    maxNodes?: number;
    lodHint?: number;
    viewport?: Viewport;
  };
}

export type PhyloLensAncillaryData = NonNullable<PhyloLensLoadOptions["ancillaryData"]>;

export interface PhyloLensAncillaryResult {
  matchedNodeCount: number;
  warnings: string[];
}

export interface PhyloLensView {
  load: (options: PhyloLensLoadOptions) => Promise<void>;
  /** Replace the visual mapping of a loaded tree and schedule a viewport refresh. */
  updateVisualMapping: (mapping: VisualMappingOptions) => void;
  applyAncillaryData: (data: PhyloLensAncillaryData) => Promise<PhyloLensAncillaryResult>;
  exportPng: () => Promise<Blob>;
  dispose: () => void;
}

export function createPhyloLensView(options: PhyloLensViewOptions): PhyloLensView {
  const workbench = createWorkbench(options);
  let disposed = false;

  return {
    load: async ({ content, name, sourceFormat = SOURCE_FORMAT_NEWICK, ...loadOptions }) => {
      if (disposed) {
        throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
      }
      const renderOptions = {
        ...loadOptions,
        sourceFormat,
      } satisfies RenderNewickOptions;
      try {
        await workbench.renderNewick(content, name, renderOptions);
      } catch (error) {
        if (disposed && error instanceof Error && error.message === ERR_GRAPH_LOAD_SUPERSEDED) {
          throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
        }
        throw error;
      }
    },
    applyAncillaryData: async (data) => {
      if (disposed) throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
      try {
        const result = await workbench.applyAncillaryData(data);
        return { matchedNodeCount: result.matched_node_count, warnings: result.warnings };
      } catch (error) {
        if (disposed) throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
        throw error;
      }
    },
    updateVisualMapping: (mapping) => {
      if (disposed) {
        throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
      }
      workbench.updateVisualMapping(mapping);
    },
    exportPng: () => {
      if (disposed) {
        throw new Error(ERR_PHYLO_LENS_VIEW_DISPOSED);
      }
      return workbench.exportPng();
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      workbench.dispose();
    },
  };
}

function createWorkbench({ container, apiUrl }: PhyloLensViewOptions): GraphWorkbench {
  const options: GraphWorkbenchOptions = {
    graphClient: createGraphClient({ baseUrl: apiUrl }),
    rendererFactory: rendererFactory(),
    rendererKind: RENDERER_KIND_SIGMA,
    renderContext: { container },
  };
  const snapshotObserver = snapshotAppliedObserverForContainer(container);
  return snapshotObserver ? createGraphWorkbench(options, snapshotObserver) : createGraphWorkbench(options);
}
