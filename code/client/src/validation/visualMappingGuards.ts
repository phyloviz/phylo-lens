import type { VisualMappingOptions, SizeMappingOptions } from '../render/mapping/visualMapping';
import type { PieMappingOptions } from '../render/mapping/pieMapping.types';
import { isBoolean, isRecord, isString, isStringArray } from './guards';

/** Check editable mapping JSON before it becomes application configuration. */
export function isVisualMapping(value: unknown): value is VisualMappingOptions {
    return (
        isRecord(value) &&
        (value.colorField === undefined || isString(value.colorField)) &&
        (value.size === undefined || isSizeMapping(value.size)) &&
        (value.palette === undefined || isStringArray(value.palette)) &&
        (value.pie === undefined || isPieMapping(value.pie))
    );
}

function isSizeMapping(value: unknown): value is SizeMappingOptions {
    return (
        isRecord(value) &&
        (value.field === undefined || isString(value.field)) &&
        (value.scale === undefined || value.scale === 'linear' || value.scale === 'log')
    );
}

function isPieMapping(value: unknown): value is PieMappingOptions {
    return (
        isRecord(value) &&
        (value.enabled === undefined || isBoolean(value.enabled)) &&
        (value.fields === undefined || isStringArray(value.fields)) &&
        (value.palette === undefined || isStringArray(value.palette)) &&
        (value.categoryColors === undefined ||
            (isRecord(value.categoryColors) && Object.values(value.categoryColors).every(isString))) &&
        (value.categoryGrouping === undefined ||
            (isRecord(value.categoryGrouping) &&
                Object.values(value.categoryGrouping).every(mode => mode === 'separate' || mode === 'other')))
    );
}
