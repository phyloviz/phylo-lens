import { describe, expect, it, vi } from 'vitest';
import visualMappingPalette from '../src/app/shell/palette/visualMappingPalette';
import { decodeApiMetadata } from '../src/ancillary/apiMetadata';
import type { PositionedGraph } from '../src/contracts/positioned';
import { deferred } from './helpers/state';

describe('palette lifecycle', () => {
  function setup() {
    const container = document.createElement('div');
    const loadInput = document.createElement('input');
    let fields = ['country'];
    const graph: PositionedGraph = {
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: { annotations: decodeApiMetadata({ country: 'Portugal', origin: 'Portugal' }) },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    };
    const updateVisualMapping = vi.fn();
    const palette = visualMappingPalette({
      container,
      loadInput,
      getGraph: () => graph,
      getSelectedFields: () => fields,
      getSizeFieldValue: () => 'profile_count',
      getSizeScaleValue: () => 'log',
      onChanged: vi.fn(),
      setStatus: vi.fn(),
      setFailureStatus: vi.fn(),
      saveFilename: 'colors.txt',
      updateVisualMapping,
    });
    palette.setBaseVisualMapping({});
    palette.renderControls();
    const color = () => container.querySelector<HTMLInputElement>('input[type=color]')!;
    const select = (next: string[]) => {
      fields = next;
      palette.renderControls();
      palette.applyControlChange();
    };
    return { palette, color, select, updateVisualMapping, loadInput };
  }

  it('keeps category overrides scoped to the selected field combination', () => {
    const { palette, color, select } = setup();
    const original = color().value;
    color().value = '#123456';
    palette.applyControlChange();
    expect(palette.getCategoryColorOverrides()).toEqual({ Portugal: '#123456' });
    select(['origin']);
    expect(color().value).toBe(original);
    expect(palette.getCategoryColorOverrides()).toEqual({});
    select(['country']);
    expect(color().value).toBe('#123456');
  });

  it('resets colors while preserving sizing, fields and category grouping', () => {
    const { palette, color, updateVisualMapping } = setup();
    const original = color().value;
    palette.setBaseVisualMapping({
      size: { field: 'profile_count', scale: 'log' },
      pie: { fields: ['country'], categoryColors: { Portugal: '#123456' }, categoryGrouping: { Portugal: 'separate' } },
    });
    palette.renderControls();
    expect(color().value).toBe('#123456');
    palette.resetColors();
    expect(color().value).toBe(original);
    expect(updateVisualMapping).toHaveBeenLastCalledWith(
      expect.objectContaining({
        size: { field: 'profile_count', scale: 'log' },
        pie: { enabled: true, fields: ['country'], categoryGrouping: { Portugal: 'separate' } },
      })
    );
    palette.renderControls();
    expect(color().value).toBe(original);
  });

  it('does not carry custom colors into a new dataset', () => {
    const { palette, color } = setup();
    const original = color().value;
    color().value = '#123456';
    palette.applyControlChange();
    palette.reset();
    palette.setBaseVisualMapping({});
    palette.renderControls();
    expect(color().value).toBe(original);
    expect(palette.getCategoryColorOverrides()).toEqual({});
  });

  it('does not restore colors from a file read that finishes after Reset', async () => {
    const { palette, color, loadInput } = setup();
    const original = color().value;
    const text = deferred<string>();
    const file = new File([], 'palette.txt');
    Object.defineProperty(file, 'text', { value: () => text.promise });
    Object.defineProperty(loadInput, 'files', { value: [file] });
    const loading = palette.load();
    palette.resetColors();
    text.resolve('18,52,86');
    await loading;
    expect(color().value).toBe(original);
    expect(palette.getCategoryColorOverrides()).toEqual({});
  });
});
