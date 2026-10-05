import type { GraphSearchMatch } from "./GraphSearchMatch";

export interface GraphSearchResult {
  datasetId: string;
  query: string;
  matches: GraphSearchMatch[];
  totalCount: number;
}
