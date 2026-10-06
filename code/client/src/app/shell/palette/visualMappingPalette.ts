import { initialPaletteState, reducePalette, type PaletteAction } from './paletteState';
import { toError } from '../../errors';
import { normalizedPieFields } from '../../../render/mapping/pieMapping';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import type { PositionedGraph } from '../../../contracts/positioned';
import {
  resolveMappingPalette,
  copyVisualMapping,
  type VisualMappingOptions,
} from '../../../render/mapping/visualMapping';
import { buildVisualMappingForControls } from '../controls/visualMappingControls';
import { downloadTextFile, readTextFile } from '../inputs/fileInputs';
import { parseCategoryColorPalette, serializeCategoryColorPalette } from './categoryPalette';
import categoryColorControls from './categoryColorControls';

export type VisualMappingPaletteOptions = {
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
};

export default function (options: VisualMappingPaletteOptions) {
  let state = initialPaletteState();
  let revision = 0;
  const dispatch = (action: PaletteAction) => {
    state = reducePalette(state, action);
  };
  const fieldKey = (fields: string[]) => JSON.stringify(normalizedPieFields(fields));
  const currentGrouping = () => state.groupingByFields[fieldKey(options.getSelectedFields())] ?? {};
  const controls = categoryColorControls(options.container);

  return {
    getCurrentVisualMapping: getCurrentVisualMapping,
    getCategoryColorOverrides: getCategoryColorOverrides,
    setBaseVisualMapping: setBaseVisualMapping,
    reset: reset,
    renderControls: renderControls,
    applyControlChange: applyControlChange,
    load: load,
    save: save,
  };

  function getCurrentVisualMapping(): VisualMappingOptions {
    return copyVisualMapping(state.mapping);
  }

  function getCategoryColorOverrides(): Record<string, string> {
    return { ...state.colors };
  }

  function setBaseVisualMapping(mapping: VisualMappingOptions): void {
    revision++;
    dispatch({ kind: 'baseChanged', mapping, fieldKey: fieldKey(options.getSelectedFields()) });
    dispatch({ kind: 'mappingApplied', mapping: buildCurrentVisualMapping() });
  }

  function reset(): void {
    revision++;
    dispatch({ kind: 'reset' });
  }

  function renderControls(): void {
    controls.render({
      graph: options.getGraph(),
      selectedFields: options.getSelectedFields(),
      categoryColorOverrides: { ...state.colors },
      palette: resolveMappingPalette(state.mapping),
      categoryGrouping: currentGrouping(),
    });
  }

  function applyControlChange(): void {
    revision++;
    applyMapping();
  }

  function applyMapping(): void {
    const { fields, grouping } = controls.readGrouping();
    dispatch({
      kind: 'controlsRead',
      fieldKey: fieldKey(fields),
      grouping,
      colors: controls.readSelectedColors(true) ?? {},
    });
    dispatch({ kind: 'mappingApplied', mapping: buildCurrentVisualMapping() });
    if (options.getGraph()) {
      try {
        options.workbench.updateVisualMapping(copyVisualMapping(state.mapping));
      } catch (error) {
        options.setFailureStatus(toError(error).message);
      }
    }
    options.onChanged();
  }

  async function load(): Promise<void> {
    const file = options.loadInput?.files?.[0];
    if (!file) return;
    const request = ++revision;
    const selectedFields = fieldKey(options.getSelectedFields());
    const isCurrent = () => request === revision && selectedFields === fieldKey(options.getSelectedFields());
    const categories = controls.readEditableOrder();
    try {
      const content = await readTextFile(file);
      if (!isCurrent()) return;
      const colors = parseCategoryColorPalette(content, categories);
      dispatch({ kind: 'colorsLoaded', colors });
      renderControls();
      applyMapping();
      if (isCurrent()) options.setStatus(`Loaded ${Object.keys(colors).length} category colors`);
    } catch (error) {
      if (isCurrent()) options.setFailureStatus(toError(error).message);
    } finally {
      if (isCurrent() && options.loadInput?.files?.[0] === file) options.loadInput.value = '';
    }
  }

  function save(): void {
    const colors = controls.readSelectedColors();
    const categories = controls.readEditableOrder();
    if (!colors || categories.length === 0) {
      options.setFailureStatus('no category colors to save');
      return;
    }

    downloadTextFile(options.saveFilename, serializeCategoryColorPalette(colors, categories));
    options.setStatus(`Saved ${categories.length} category colors`);
  }

  function buildCurrentVisualMapping(): VisualMappingOptions {
    const mapping = buildVisualMappingForControls(
      state.baseMapping,
      options.getSelectedFields(),
      options.getSizeFieldValue(),
      options.getSizeScaleValue(),
      { ...state.colors }
    );
    const pie = mapping.pie && { ...mapping.pie };
    if (pie) {
      const grouping = currentGrouping();
      if (Object.keys(grouping).length) pie.categoryGrouping = grouping;
      else delete pie.categoryGrouping;
    }
    const enabled = options.getPiesEnabled?.();
    return enabled !== undefined ? { ...mapping, pie: { ...pie, enabled } } : pie ? { ...mapping, pie } : mapping;
  }
}
