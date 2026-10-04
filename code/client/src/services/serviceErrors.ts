export const ERR_PHYLO_LENS_SERVICE_UNAVAILABLE = "PhyloLens service is unavailable.";
export const ERR_PHYLO_LENS_SERVICE_PROTOCOL = "Invalid PhyloLens service information response.";
export const ERR_INCOMPATIBLE_PHYLO_LENS_SERVICE = "Incompatible PhyloLens service API version.";

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
