import { isRecord } from "../validation/guards";

interface ServiceInformation {
  status: string;
  service_version: string;
  api_version: string;
}

export function isServiceInformation(value: unknown): value is ServiceInformation {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.service_version === "string" &&
    typeof value.api_version === "string"
  );
}
