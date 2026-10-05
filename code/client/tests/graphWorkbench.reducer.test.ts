import { describe, expect, it } from 'vitest';
import { createInitialWorkbenchState, getGraphSnapshot } from '../src/app/workbench/graphWorkbench.state';
import { reduceGraphWorkbenchState as reduce } from '../src/app/workbench/graphWorkbench.reducer';
import { prepareResult } from './fixtures/graph';
import { freezeInput } from './helpers/state';

function readyState() {
    const prepared = prepareResult();
    const preparing = reduce(createInitialWorkbenchState(), { kind: 'loadStarted' });
    const loading = reduce(preparing, {
        kind: 'graphPrepared',
        session: { datasetId: prepared.datasetId, layoutVersion: prepared.layoutVersion, lod: {} },
    });
    return reduce(loading, {
        kind: 'viewportApplied',
        graph: { nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } },
    });
}

describe('workbench state transitions', () => {
    it('changes only the affected state and preserves frozen inputs', () => {
        const before = freezeInput(readyState());
        const filters = freezeInput({ categorical: [{ fieldKey: 'country', acceptedValues: ['PT'] }], numeric: [] });
        const after = reduce(before, { kind: 'filtersUpdated', filters });
        expect(after.activeFilters).toEqual(filters);
        expect(after.activeFilters).not.toBe(filters);
        expect(getGraphSnapshot(after)).toBe(getGraphSnapshot(before));
        expect(before.activeFilters).toEqual({ categorical: [], numeric: [] });
        expect(reduce(before, { kind: 'lodRefreshPaused', paused: false })).toBe(before);
    });

    it('owns mappings and display options without retaining caller-owned values', () => {
        const mapping = {
            size: { field: 'year' },
            pie: {
                fields: ['country'],
                palette: ['#123456'],
                categoryColors: { PT: '#123456' },
                categoryGrouping: { PT: 'separate' as const },
            },
        };
        const display = { nodeLabels: false };
        const mapped = reduce(freezeInput(readyState()), { kind: 'visualMappingUpdated', visualMapping: mapping });
        const result = reduce(mapped, { kind: 'displayOptionsUpdated', displayOptions: display });
        mapping.size.field = 'country';
        mapping.pie.fields.push('year');
        mapping.pie.palette[0] = '#ffffff';
        mapping.pie.categoryColors.PT = '#ffffff';
        display.nodeLabels = true;
        if (result.kind !== 'ready') throw new Error('Expected a ready graph');
        expect(result.session.visualMapping?.size?.field).toBe('year');
        expect(result.session.visualMapping?.pie?.fields).toEqual(['country']);
        expect(result.session.visualMapping?.pie?.palette).toEqual(['#123456']);
        expect(result.session.visualMapping?.pie?.categoryColors).toEqual({ PT: '#123456' });
        expect(result.session.displayOptions?.nodeLabels).toBe(false);
        expect(Object.isFrozen(mapping.pie.fields)).toBe(false);
        expect(Object.isFrozen(result.session.visualMapping?.pie?.fields)).toBe(true);
    });

    it('keeps failures explicit, removes the old session and starts a fresh load', () => {
        const failure = new Error('Service unavailable');
        const failed = reduce(freezeInput(readyState()), { kind: 'loadFailed', error: failure });
        expect(failed.kind).toBe('failed');
        expect(failed).not.toHaveProperty('session');
        expect(getGraphSnapshot(failed)).toBeNull();
        if (failed.kind !== 'failed') throw new Error('Expected a failed state');
        expect(failed.error).toBe(failure);
        const restarting = reduce(freezeInput(failed), { kind: 'loadStarted' });
        expect(restarting.kind).toBe('preparing');
        expect(restarting).not.toHaveProperty('error');
        expect(
            reduce(createInitialWorkbenchState(), {
                kind: 'viewportApplied',
                graph: { nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } },
            }).kind
        ).toBe('idle');
    });
});
