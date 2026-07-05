import { isRecord } from "../validation/guards";

export const HTTP_METHOD_POST = "POST";
export const HTTP_METHOD_GET = "GET";
export const HEADER_CONTENT_TYPE = "Content-Type";
export const CONTENT_TYPE_JSON = "application/json";

export const ERR_HTTP_PREFIX = "HTTP error";
export const KEY_DETAIL = "detail";

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface HttpClient {
  post: <TRequest, TResponse>(
    path: string,
    body: TRequest,
  ) => Promise<TResponse>;
  get: <TResponse>(path: string) => Promise<TResponse>;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? safeFetch;

  return {
    post: <TRequest, TResponse>(path: string, body: TRequest) =>
      post<TRequest, TResponse>({
        baseUrl: options.baseUrl,
        fetchImpl,
        path,
        body,
      }),
    get: <TResponse>(path: string) =>
      get<TResponse>({ baseUrl: options.baseUrl, fetchImpl, path }),
  };
}

interface PostJsonOptions<TRequest> {
  baseUrl: string;
  fetchImpl: typeof fetch;
  path: string;
  body: TRequest;
}

async function post<TRequest, TResponse>({
  baseUrl,
  fetchImpl,
  path,
  body,
}: PostJsonOptions<TRequest>): Promise<TResponse> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: HTTP_METHOD_POST,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

interface GetJsonOptions {
  baseUrl: string;
  fetchImpl: typeof fetch;
  path: string;
}

async function get<TResponse>({
  baseUrl,
  fetchImpl,
  path,
}: GetJsonOptions): Promise<TResponse> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: HTTP_METHOD_GET,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

async function buildHttpErrorMessage(response: Response): Promise<string> {
  const detailMessage = await readErrorDetail(response);

  if (detailMessage) {
    return `${ERR_HTTP_PREFIX}: ${response.status} - ${detailMessage}`;
  }

  return `${ERR_HTTP_PREFIX}: ${response.status}`;
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

  if (
    Array.isArray(errors) &&
    errors.every((item) => typeof item === "string")
  ) {
    return errors.join("; ");
  }

  return null;
}

const safeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
