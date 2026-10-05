import type { DatasetId } from '../graphIdentifiers';
import type { GraphSearchMatch } from './GraphSearchMatch';

export type GraphSearchResult = {
    readonly datasetId: DatasetId;
    readonly query: string;
    readonly matches: readonly GraphSearchMatch[];
    readonly totalCount: number;
};
