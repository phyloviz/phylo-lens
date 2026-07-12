import { isRecord } from "../validation/guards";

const HEADER_CONTENT_TYPE = "Content-Type";
const CONTENT_TYPE_JSON = "application/json";
const ERR_HTTP_PREFIX = "HTTP error";
const KEY_DETAIL = "detail";

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export function createHttpClient({ baseUrl, fetchImpl = safeFetch }: HttpClientOptions) {
  async function request<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    return response.json() as Promise<TResponse>;
  }

  function get<TResponse>(path: string): Promise<TResponse> {
    return request<TResponse>(path);
  }

  function post<TRequest, TResponse>(path: string, body: TRequest): Promise<TResponse> {
    return request<TResponse>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  return {
    get,
    post,
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

async function buildHttpErrorMessage(response: Response): Promise<string> {
  const detail = await readErrorDetail(response);

  return detail ? `${ERR_HTTP_PREFIX}: ${response.status} - ${detail}` : `${ERR_HTTP_PREFIX}: ${response.status}`;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    return extractErrorDetail(await response.json());
  } catch {
    return null;
  }
}

function extractErrorDetail(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const detail = payload[KEY_DETAIL];

  if (typeof detail === "string") {
    return detail;
  }

  if (!isRecord(detail)) {
    return null;
  }

  const errors = detail.errors;

  return Array.isArray(errors) && errors.every((error) => typeof error === "string") ? errors.join("; ") : null;
}

const safeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
