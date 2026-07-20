import { createGraphClient } from "./api/graphClient";
import { SOURCE_FORMAT_NEWICK, type MetadataField, type SourceFormat, type Viewport } from "./contracts/models";
import rendererFactory from "./render/rendererFactory";
import { RENDERER_KIND_SIGMA } from "./render/renderer.types";
import type { VisualMappingOptions } from "./render/mapping/visualMapping";
import { createGraphWorkbench, type GraphWorkbench, type RenderNewickOptions } from "./app/workbench/graphWorkbench";

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
    join_column?: string;
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

export interface PhyloLensView {
  load: (options: PhyloLensLoadOptions) => Promise<void>;
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
      await workbench.renderNewick(content, name, renderOptions);
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
  return createGraphWorkbench({
    graphClient: createGraphClient({ baseUrl: apiUrl }),
    rendererFactory: rendererFactory(),
    rendererKind: RENDERER_KIND_SIGMA,
    renderContext: { container },
  });
}
