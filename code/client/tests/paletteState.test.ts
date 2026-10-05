import { expect, it } from 'vitest';
import { initialPaletteState, reducePalette } from '../src/app/shell/palette/paletteState';
import { reduceExpansionControls } from '../src/app/shell/controls/expansionState';
import { toClusterId } from '../src/contracts/graph/graphIdentifiers';
import { freezeInput } from './helpers/state';

it('keeps palette inputs, saved groupings and previous states independent', () => {
    const base = { pie: { fields: ['country'], categoryColors: { PT: '#123456' } } };
    const state = reducePalette(freezeInput(initialPaletteState()), {
        kind: 'baseChanged',
        mapping: base,
        fieldKey: 'country',
    });
    const grouping = { PT: 'separate' as const };
    const colors = { PT: '#ffffff' };
    const next = reducePalette(freezeInput(state), { kind: 'controlsRead', grouping, colors, fieldKey: 'country' });
    base.pie.fields.push('year');
    colors.PT = '#000000';
    Object.assign(grouping, { PT: 'other' });
    expect(next.baseMapping.pie?.fields).toEqual(['country']);
    expect(next.colors.PT).toBe('#ffffff');
    expect(next.groupingByFields.country.PT).toBe('separate');
    expect(state.colors.PT).toBe('#123456');
});

it('keeps expansion-control transitions separate from the asynchronous operation', () => {
    const selected = { clusterId: toClusterId('cluster'), expandable: true };
    const ready = reduceExpansionControls({ kind: 'unavailable' }, { kind: 'ready' });
    const chosen = reduceExpansionControls(freezeInput(ready), { kind: 'selected', selected });
    selected.expandable = false;
    const updating = reduceExpansionControls(freezeInput(chosen), { kind: 'started' });
    expect(updating).toMatchObject({ kind: 'updating', selected: { expandable: true } });
    expect(reduceExpansionControls(updating, { kind: 'started' })).toBe(updating);
    const unavailable = reduceExpansionControls(updating, { kind: 'unavailable' });
    expect(reduceExpansionControls(unavailable, { kind: 'finished', failure: null })).toBe(unavailable);
});
