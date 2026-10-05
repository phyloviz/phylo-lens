import { describe, expect, it } from 'vitest';
import { copyFilterState, hasActiveFilters, matchesFilterState } from '../src/ancillary/filterEngine';
import { freezeInput } from './helpers/state';

describe('ancillary filters', () => {
    it('combines categorical and numeric criteria without changing their inputs', () => {
        const filters = freezeInput({
            categorical: [{ fieldKey: 'country', acceptedValues: ['PT', 'ES'] }],
            numeric: [{ fieldKey: 'year', min: 2020, max: 2022 }],
        });
        expect(matchesFilterState(freezeInput({ country: 'PT', year: 2020 }), filters)).toBe(true);
        expect(matchesFilterState({ country: 'ES', year: 2022 }, filters)).toBe(true);
        expect(matchesFilterState({ country: 'FR', year: 2021 }, filters)).toBe(false);
        expect(matchesFilterState({ country: 'PT', year: 2023 }, filters)).toBe(false);
        expect(matchesFilterState({ country: 'PT' }, filters)).toBe(false);
    });

    it('ignores empty criteria and compares boolean or numeric categories as text', () => {
        const filters = {
            categorical: [
                { fieldKey: 'resistant', acceptedValues: ['true'] },
                { fieldKey: 'unused', acceptedValues: [] },
            ],
            numeric: [{ fieldKey: 'year' }],
        };
        expect(matchesFilterState({ resistant: true }, filters)).toBe(true);
        expect(matchesFilterState({ resistant: false }, filters)).toBe(false);
        expect(hasActiveFilters({ categorical: [], numeric: [] })).toBe(false);
    });

    it('takes ownership of filter arrays, entries and accepted values', () => {
        const input = {
            categorical: [{ fieldKey: 'country', acceptedValues: ['PT'] }],
            numeric: [{ fieldKey: 'year', min: 2020 }],
        };
        const owned = copyFilterState(input);
        input.categorical[0].acceptedValues.push('FR');
        input.numeric[0].min = 1900;
        expect(matchesFilterState({ country: 'FR', year: 2021 }, owned)).toBe(false);
        expect(matchesFilterState({ country: 'PT', year: 2000 }, owned)).toBe(false);
        expect(Object.isFrozen(input)).toBe(false);
        expect(Object.isFrozen(owned.categorical[0].acceptedValues)).toBe(true);
    });
});
