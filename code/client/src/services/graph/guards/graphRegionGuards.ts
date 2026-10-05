import { isAncillaryData } from '../../../validation/ancillaryGuards';
import type { GraphRegionResponseDto } from '../models/region/GraphRegionResponseDto';
import { isRecord, isString, isBoolean, isFiniteNumber, isArrayOf } from '../../../validation/guards';
import { isGraphLayoutStatus, isOptionalGraphMetadataSchema } from './graphDataGuards';
import { isGraphViewportNodeDto, isGraphViewportEdgeDto } from './graphViewportGuards';

export function isGraphRegionResponseDto(value: unknown): value is GraphRegionResponseDto {
    return (
        isRecord(value) &&
        isString(value.dataset_id) &&
        isString(value.layout_version) &&
        isGraphLayoutStatus(value.layout_status) &&
        isBoolean(value.truncated) &&
        isFiniteNumber(value.total_node_count) &&
        isArrayOf(value.nodes, isGraphViewportNodeDto) &&
        isArrayOf(value.edges, isGraphViewportEdgeDto) &&
        isOptionalGraphMetadataSchema(value.metadata_schema) &&
        isAncillaryData(value.aggregated_metadata)
    );
}
