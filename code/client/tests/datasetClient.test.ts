import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DatasetClient,
  ERR_INVALID_RESPONSE,
  isCanonicalDataset,
  isNormalizeResponse,
  ROUTE_NORMALIZE,
} from "../src/api/datasetClient";
import { SOURCE_FORMAT_NEWICK } from "../src/contracts/canonical";

const BASE_URL = "http://localhost:8000";
const DATASET_NAME = "fixture-tree";
const NEWICK_CONTENT = "(A,B)Root;";

const FIXTURE_FILE = "normalizeResponse.json";
const FIXTURE_DIR = "fixtures";
const TESTS_DIR = "tests";

function loadNormalizeFixture(): unknown {
  const fixturePath = join(process.cwd(), TESTS_DIR, FIXTURE_DIR, FIXTURE_FILE);
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

function makeJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("datasetClient", () => {
  it("validates a fixture response through runtime guards", () => {
    const fixture = loadNormalizeFixture();

    expect(isNormalizeResponse(fixture)).toBe(true);

    const dataset = (fixture as { dataset: unknown }).dataset;
    expect(isCanonicalDataset(dataset)).toBe(true);
  });

  it("sends normalize requests to the expected endpoint", async () => {
    const fixture = loadNormalizeFixture();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${BASE_URL}${ROUTE_NORMALIZE}`);
      return makeJsonResponse(fixture);
    }) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    const result = await client.normalizeDataset({
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: DATASET_NAME,
      content: NEWICK_CONTENT,
    });

    expect(result.dataset.dataset_id).toBe("small-tree");
    expect(result.stats.node_count).toBe(3);
  });

  it("rejects invalid response shapes", async () => {
    const invalidPayload = { invalid: true };
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse(invalidPayload),
    ) as unknown as typeof fetch;

    const client = new DatasetClient({
      baseUrl: BASE_URL,
      fetchImpl: fetchSpy,
    });

    await expect(
      client.normalizeDataset({
        format: SOURCE_FORMAT_NEWICK,
        dataset_name: DATASET_NAME,
        content: NEWICK_CONTENT,
      }),
    ).rejects.toThrow(ERR_INVALID_RESPONSE);
  });
});
