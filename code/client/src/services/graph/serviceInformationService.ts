import type { ServiceInformationDto } from './models/service/ServiceInformationDto';
import type { HttpClient } from '../httpClient';
import { GRAPH_ROUTES } from './graphRoutes';
import {
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
  IncompatiblePhyloLensServiceError,
  ERR_PHYLO_LENS_SERVICE_UNAVAILABLE,
} from '../serviceErrors';
import { isServiceInformationDto } from './guards/serviceInformationGuard';

export const SUPPORTED_PHYLO_LENS_API_VERSION = '1';

export async function checkAPIService(http: HttpClient): Promise<void> {
  let response: ServiceInformationDto;

  try {
    response = await http.get<ServiceInformationDto>(GRAPH_ROUTES.health);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PhyloLensServiceProtocolError(undefined, { cause: error });
    }

    throw new PhyloLensServiceUnavailableError(serviceUnavailableMessage(error), {
      cause: error,
    });
  }

  if (!isServiceInformationDto(response)) {
    throw new PhyloLensServiceProtocolError();
  }

  if (response.api_version !== SUPPORTED_PHYLO_LENS_API_VERSION) {
    throw new IncompatiblePhyloLensServiceError(SUPPORTED_PHYLO_LENS_API_VERSION, response.api_version);
  }
}

function serviceUnavailableMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `${ERR_PHYLO_LENS_SERVICE_UNAVAILABLE} ${error.message}`;
  }

  return ERR_PHYLO_LENS_SERVICE_UNAVAILABLE;
}
