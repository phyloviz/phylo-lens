import { isRecord } from "../validation/guards";
import type { HttpClient } from "./httpClient";

export const ROUTE_SERVICE_HEALTH = "/health";
export const SUPPORTED_PHYLO_LENS_API_VERSION = "1";

export const ERR_PHYLO_LENS_SERVICE_UNAVAILABLE = "PhyloLens service is unavailable.";
export const ERR_PHYLO_LENS_SERVICE_PROTOCOL = "Invalid PhyloLens service information response.";
export const ERR_INCOMPATIBLE_PHYLO_LENS_SERVICE = "Incompatible PhyloLens service API version.";

interface ServiceInformation {
  status: string;
  service_version: string;
  api_version: string;
}

export class PhyloLensServiceUnavailableError extends Error {
  constructor(message = ERR_PHYLO_LENS_SERVICE_UNAVAILABLE, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PhyloLensServiceUnavailableError";
  }
}

export class PhyloLensServiceProtocolError extends Error {
  constructor(message = ERR_PHYLO_LENS_SERVICE_PROTOCOL, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PhyloLensServiceProtocolError";
  }
}

export class IncompatiblePhyloLensServiceError extends Error {
  readonly expectedApiVersion: string;
  readonly receivedApiVersion: string;

  constructor(expectedApiVersion: string, receivedApiVersion: string) {
    super(`${ERR_INCOMPATIBLE_PHYLO_LENS_SERVICE} Expected ${expectedApiVersion}, received ${receivedApiVersion}.`);
    this.name = "IncompatiblePhyloLensServiceError";
    this.expectedApiVersion = expectedApiVersion;
    this.receivedApiVersion = receivedApiVersion;
  }
}

export async function validateServiceCompatibility(http: HttpClient): Promise<void> {
  let response: unknown;

  try {
    response = await http.get<unknown>(ROUTE_SERVICE_HEALTH);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PhyloLensServiceProtocolError(undefined, { cause: error });
    }

    throw new PhyloLensServiceUnavailableError(serviceUnavailableMessage(error), {
      cause: error,
    });
  }

  if (!isServiceInformation(response)) {
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

function isServiceInformation(value: unknown): value is ServiceInformation {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.service_version === "string" &&
    typeof value.api_version === "string"
  );
}
