export const HTTP_METHOD_POST = "POST";
export const HEADER_CONTENT_TYPE = "Content-Type";
export const CONTENT_TYPE_JSON = "application/json";

export const ERR_HTTP_PREFIX = "HTTP error";

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const safeFetch: typeof fetch = (...args) => globalThis.fetch(...args);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl ?? safeFetch;
  }

  // Send a JSON POST request and parse a JSON response.
  async postJson<TRequest, TResponse>(
    path: string,
    body: TRequest,
  ): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: HTTP_METHOD_POST,
      headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${ERR_HTTP_PREFIX}: ${response.status}`);
    }

    return (await response.json()) as TResponse;
  }
}
