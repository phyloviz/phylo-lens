export async function withTimeout(name, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`timeout:${name}`);
          error.code = "STAGE_TIMEOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function classifyFailure(error, lastStage) {
  const message = String(error);
  if (message.includes("invalid_configuration")) return "invalid_configuration";
  if (message.includes("replay API") || message.includes("replay health")) return "replay_contract_failure";
  if (message.includes("empty_visual_output") || message.includes("invalid_visual_output")) return "empty_visual_output";
  if (lastStage.startsWith("chromium_launch") || lastStage.startsWith("playwright_connect")) return "browser_launch_failure";
  if (lastStage.startsWith("bootstrap")) return "bootstrap_failure";
  if (lastStage.startsWith("view_load")) return error?.code === "STAGE_TIMEOUT" ? "render_timeout" : "client_load_failure";
  if (lastStage === "load_start") return "client_load_failure";
  return "harness_protocol_failure";
}

export async function closeAll(resources, onFailure = () => {}) {
  for (const [name, resource] of resources) {
    if (!resource?.close) continue;
    try {
      await resource.close();
    } catch (error) {
      onFailure(name, error);
    }
  }
}

export async function atomicWriteJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(payload, null, 2));
  await rename(temporary, path);
}
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
