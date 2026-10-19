import { describe, expect, it, vi } from 'vitest';
import { distanceEdgeColor, showsDistanceLabel } from '../src/render/mapping/edgeMapping';
import createDisplayControls from '../src/app/shell/controls/displayOptionsControls';

describe('edge presentation', () => {
  it('uses inclusive, optional bounds without labeling missing or invalid distances', () => {
    const display = { edgeDistanceLabels: true, edgeDistanceLabelMin: 2, edgeDistanceLabelMax: 4 };
    expect([undefined, NaN, Infinity, 1, 2, 3, 4, 5].map(value => showsDistanceLabel(value, display))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(showsDistanceLabel(0, { edgeDistanceLabels: true, edgeDistanceLabelMax: 0 })).toBe(true);
    expect(showsDistanceLabel(10, { edgeDistanceLabels: true, edgeDistanceLabelMin: 4 })).toBe(true);
    expect(showsDistanceLabel(3, { ...display, edgeDistanceLabels: false })).toBe(false);
  });

  it('maps fixed weights to black and gray independently of other edges', () => {
    expect([0, 1, 2, 4, 10].map(value => distanceEdgeColor(value, '#94a3b8'))).toEqual([
      '#000000',
      '#000000',
      '#646464',
      '#969696',
      '#b4b4b4',
    ]);
    expect(distanceEdgeColor(null, '#94a3b8')).toBe('#94a3b8');
  });

  it('applies live interval edits, removes blank bounds and releases handlers', () => {
    const edgeLabelMinInput = document.createElement('input');
    const edgeLabelMaxInput = document.createElement('input');
    const updateDisplayOptions = vi.fn();
    const controls = createDisplayControls({ updateDisplayOptions }, { edgeLabelMinInput, edgeLabelMaxInput });
    controls.mount();
    edgeLabelMinInput.value = '0';
    edgeLabelMaxInput.value = '5';
    edgeLabelMaxInput.dispatchEvent(new Event('input'));
    expect(updateDisplayOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ edgeDistanceLabelMin: 0, edgeDistanceLabelMax: 5 })
    );
    edgeLabelMinInput.value = '8';
    edgeLabelMinInput.dispatchEvent(new Event('input'));
    expect(edgeLabelMaxInput.validity.valid).toBe(false);
    edgeLabelMinInput.value = '';
    edgeLabelMaxInput.value = '';
    edgeLabelMaxInput.dispatchEvent(new Event('input'));
    expect(updateDisplayOptions.mock.lastCall?.[0]).not.toHaveProperty('edgeDistanceLabelMin');
    expect(updateDisplayOptions.mock.lastCall?.[0]).not.toHaveProperty('edgeDistanceLabelMax');
    const count = updateDisplayOptions.mock.calls.length;
    controls.unmount();
    edgeLabelMaxInput.dispatchEvent(new Event('input'));
    expect(updateDisplayOptions).toHaveBeenCalledTimes(count);
  });
});
