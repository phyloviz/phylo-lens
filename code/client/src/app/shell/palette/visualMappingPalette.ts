import type { GraphWorkbench } from "../../workbench/graphWorkbench";
import type { PositionedGraph } from "../../../contracts/positioned";
import { resolveMappingPalette, type VisualMappingOptions } from "../../../render/mapping/visualMapping";
import { buildVisualMappingForControls } from "../controls/visualMappingControls";
import { downloadTextFile, readTextFile } from "../inputs/fileInputs";
import { parseCategoryColorPalette, serializeCategoryColorPalette } from "./categoryPalette";
import categoryColorControls from "./categoryColorControls";

export interface VisualMappingPaletteOptions {
  workbench: GraphWorkbench;
  container?: HTMLElement;
  loadInput?: HTMLInputElement;
  saveFilename: string;
  getGraph: () => PositionedGraph | null;
  getSelectedFields: () => string[];
  getPiesEnabled?: () => boolean | undefined;
  getSizeFieldValue: () => string | undefined;
  getSizeScaleValue: () => string | undefined;
  onChanged: () => void;
  setStatus: (status: string) => void;
  setFailureStatus: (message: string) => void;
}

export default function (options: VisualMappingPaletteOptions) {
  let baseVisualMapping: VisualMappingOptions = {};
  let currentVisualMapping: VisualMappingOptions = {};
  let categoryColorOverrides: Record<string, string> = {};
  const controls = categoryColorControls(options.container);

  return {
    getCurrentVisualMapping: getCurrentVisualMapping,
    getCategoryColorOverrides: getCategoryColorOverrides,
    setBaseVisualMapping: setBaseVisualMapping,
    reset: reset,
    renderControls: renderControls,
    readControlColors: readControlColors,
    applyControlChange: applyControlChange,
    load: load,
    save: save,
  };

  function getCurrentVisualMapping(): VisualMappingOptions {
    return currentVisualMapping;
  }

  function getCategoryColorOverrides(): Record<string, string> {
    return categoryColorOverrides;
  }

  function setBaseVisualMapping(visualMapping: VisualMappingOptions): void {
    baseVisualMapping = visualMapping;
    categoryColorOverrides = { ...visualMapping.pie?.categoryColors };
    currentVisualMapping = buildCurrentVisualMapping();
  }

  function reset(): void {
    baseVisualMapping = {};
    currentVisualMapping = {};
    categoryColorOverrides = {};
  }

  function renderControls(): void {
    controls.render({
      graph: options.getGraph(),
      selectedFields: options.getSelectedFields(),
      categoryColorOverrides,
      palette: resolveMappingPalette(currentVisualMapping),
    });
  }

  function readControlColors(): void {
    categoryColorOverrides = { ...categoryColorOverrides, ...controls.readSelectedColors(true) };
  }

  function applyControlChange(): void {
    readControlColors();
    currentVisualMapping = buildCurrentVisualMapping(categoryColorOverrides);

    if (!options.getGraph()) {
      options.onChanged();
      return;
    }

    try {
      options.workbench.updateVisualMapping(currentVisualMapping);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      options.setFailureStatus(message);
    }

    options.onChanged();
  }

  async function load(): Promise<void> {
    const file = options.loadInput?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const categories = controls.readEditableOrder();
      const loadedColors = parseCategoryColorPalette(await readTextFile(file), categories);
      categoryColorOverrides = {
        ...categoryColorOverrides,
        ...loadedColors,
      };
      renderControls();
      applyControlChange();
      options.setStatus(`Loaded ${Object.keys(loadedColors).length} category colors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      options.setFailureStatus(message);
    } finally {
      if (options.loadInput) {
        options.loadInput.value = "";
      }
    }
  }

  function save(): void {
    const colors = controls.readSelectedColors();
    const categories = controls.readEditableOrder();
    if (!colors || categories.length === 0) {
      options.setFailureStatus("no category colors to save");
      return;
    }

    downloadTextFile(options.saveFilename, serializeCategoryColorPalette(colors, categories));
    options.setStatus(`Saved ${categories.length} category colors`);
  }

  function buildCurrentVisualMapping(categoryColors?: Record<string, string>): VisualMappingOptions {
    const mapping = buildVisualMappingForControls(
      baseVisualMapping,
      options.getSelectedFields(),
      options.getSizeFieldValue(),
      options.getSizeScaleValue(),
      categoryColors,
    );
    const enabled = options.getPiesEnabled?.();
    if (enabled !== undefined) {
      mapping.pie = { ...mapping.pie, enabled };
    }
    return mapping;
  }
}
