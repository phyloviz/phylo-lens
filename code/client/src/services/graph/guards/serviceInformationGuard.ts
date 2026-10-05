import type { ServiceInformationDto } from "../models/service/ServiceInformationDto";
import { isRecord } from "../../../validation/guards";

export function isServiceInformationDto(value: unknown): value is ServiceInformationDto {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.service_version === "string" &&
    typeof value.api_version === "string"
  );
}
