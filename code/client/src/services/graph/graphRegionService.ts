import type { GraphRegionResponseDto } from "./models/region/GraphRegionResponseDto";
import type { HttpClient } from "../httpClient";
import type { GraphRegionRequest } from "../../contracts/graph/region/GraphRegionRequest";
import type { GraphRegionResult } from "../../contracts/graph/region/GraphRegionResult";
import type { GraphRegionRequestDto } from "./models/region/GraphRegionRequestDto";
import { GRAPH_ROUTES } from "./graphRoutes";
import { toGraphRegionRequestDto, toGraphRegionResult } from "./mappers/graphRegionMappers";
import { isGraphRegionResponseDto } from "./guards/graphRegionGuards";
import { GRAPH_API_ERRORS } from "./graphErrors";

export async function readGraphRegion(http: HttpClient, request: GraphRegionRequest): Promise<GraphRegionResult> {
  const response = await http.post<GraphRegionRequestDto, GraphRegionResponseDto>(
    GRAPH_ROUTES.region,
    toGraphRegionRequestDto(request),
  );

  if (!isGraphRegionResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidRegionResponse);
  }

  return toGraphRegionResult(response);
}
