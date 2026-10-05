import type { DatasetId } from "../graphIdentifiers";
import type { GraphSearchMatch } from "./GraphSearchMatch";

export interface GraphSearchResult {
  datasetId: DatasetId;
  query: string;
  matches: GraphSearchMatch[];
  totalCount: number;
}
