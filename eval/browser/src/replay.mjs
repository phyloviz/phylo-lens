import { createServer } from "node:http";
import { createHash } from "node:crypto";

export async function startReplayServer(fixture) {
  const accessLog = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestRecord = {
      timestamp: new Date().toISOString(),
      method: request.method,
      path: url.pathname,
      status: null,
      response_bytes: 0,
    };
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    const send = (status, payload) => {
      const body = Buffer.from(JSON.stringify(payload));
      requestRecord.status = status;
      requestRecord.response_bytes = body.length;
      accessLog.push(requestRecord);
      response.writeHead(status, {
        ...headers,
        "content-type": "application/json",
        "content-length": body.length,
      });
      response.end(body);
    };
    if (request.method === "OPTIONS") {
      requestRecord.status = 204;
      accessLog.push(requestRecord);
      response.writeHead(204, headers);
      return response.end();
    }
    if (url.pathname === "/health" && request.method === "GET")
      return send(200, {
        status: "ok",
        service_version: "replay",
        api_version: "1",
      });
    if (url.pathname === "/api/graph/prepare" && request.method === "POST") {
      const body = await readJson(request);
      if (!body || body.format !== "newick" || typeof body.content !== "string")
        return send(422, { detail: "Malformed prepare request." });
      return send(202, {
        job_id: "fixture-job",
        status: "pending",
        dataset_id: fixture.id,
      });
    }
    if (
      url.pathname === "/api/graph/prepare/fixture-job" &&
      request.method === "GET"
    )
      return send(200, {
        job_id: "fixture-job",
        status: "ready",
        result: {
          dataset_id: fixture.id,
          layout_version: fixture.checksum_sha256.slice(0, 16),
          node_count: fixture.node_count,
          edge_count: fixture.edge_count,
          cluster_count: fixture.triangle_count,
          lod_tier_count: 1,
          layout_status: "ready",
          warnings: [],
        },
      });
    if (url.pathname === "/api/graph/viewport" && request.method === "POST") {
      const body = await readJson(request);
      if (!body || body.dataset_id !== fixture.id)
        return send(422, { detail: "Malformed viewport request." });
      return send(200, {
        dataset_id: fixture.id,
        layout_version: fixture.checksum_sha256.slice(0, 16),
        lod_level: 0,
        zoom: Number.isFinite(body.zoom) ? body.zoom : 1,
        layout_status: "ready",
        truncated: false,
        total_node_count: fixture.node_count,
        nodes: fixture.nodes,
        edges: fixture.edges,
        global_bounds: fixture.bounds,
        metadata_schema: [],
      });
    }
    return send(404, { detail: "Unsupported replay endpoint." });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    accessLog,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Final RQ2 deliberately removes server/layout variability.  This loopback API
// advertises a constant large prepared graph but returns the deterministic
// fixture as the entire materialized snapshot.
export async function startFinalReplayServer({
  fixture,
  globalPreparedNodeCount,
  maxNodes,
}) {
  const accessLog = [];
  const responsePayload = {
    dataset_id: fixture.id,
    layout_version: fixture.checksum_sha256.slice(0, 16),
    lod_level: 0,
    zoom: 1,
    layout_status: "ready",
    truncated: false,
    total_node_count: globalPreparedNodeCount,
    nodes: fixture.nodes,
    edges: fixture.edges,
    global_bounds: fixture.bounds,
    metadata_schema: [],
  };
  const responseBody = Buffer.from(JSON.stringify(responsePayload));
  const responseSha256 = createHash("sha256")
    .update(responseBody)
    .digest("hex");
  const record = (request, status, body, detail = {}) => {
    const item = {
      sequence: accessLog.length + 1,
      timestamp: new Date().toISOString(),
      method: request.method,
      path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      status,
      response_bytes: body.length,
      ...detail,
    };
    accessLog.push(item);
    return item;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    const send = (status, payload, detail) => {
      const body = Buffer.from(JSON.stringify(payload));
      record(request, status, body, detail);
      response.writeHead(status, {
        ...headers,
        "content-type": "application/json",
        "content-length": body.length,
      });
      response.end(body);
    };
    if (request.method === "OPTIONS") {
      record(request, 204, Buffer.alloc(0));
      response.writeHead(204, headers);
      return response.end();
    }
    if (url.pathname === "/health" && request.method === "GET")
      return send(200, {
        status: "ok",
        service_version: "rq2-final-replay",
        api_version: "1",
      });
    if (url.pathname === "/api/graph/prepare" && request.method === "POST") {
      const body = await readJson(request);
      if (!body || body.format !== "newick" || typeof body.content !== "string")
        return send(422, { detail: "Malformed prepare request." });
      return send(202, {
        job_id: "rq2-final-fixture-job",
        status: "pending",
        dataset_id: fixture.id,
      });
    }
    if (
      url.pathname === "/api/graph/prepare/rq2-final-fixture-job" &&
      request.method === "GET"
    )
      return send(200, {
        job_id: "rq2-final-fixture-job",
        status: "ready",
        result: {
          dataset_id: fixture.id,
          layout_version: responsePayload.layout_version,
          node_count: globalPreparedNodeCount,
          edge_count: globalPreparedNodeCount - 1,
          cluster_count: fixture.triangle_count,
          lod_tier_count: 1,
          layout_status: "ready",
          warnings: [],
        },
      });
    if (url.pathname === "/api/graph/viewport" && request.method === "POST") {
      const body = await readJson(request);
      if (
        !body ||
        body.dataset_id !== fixture.id ||
        body.max_nodes !== maxNodes
      )
        return send(422, {
          detail:
            "Final RQ2 viewport request does not match frozen fixture or maxNodes.",
        });
      record(request, 200, responseBody, {
        request_body: body,
        response_sha256: responseSha256,
        fixture_node_count: fixture.node_count,
        fixture_edge_count: fixture.edge_count,
        fixture_triangle_count: fixture.triangle_count,
        truncated: false,
      });
      response.writeHead(200, {
        ...headers,
        "content-type": "application/json",
        "content-length": responseBody.length,
      });
      return response.end(responseBody);
    }
    return send(404, { detail: "Unsupported replay endpoint." });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    accessLog,
    responsePayload,
    responseSha256,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function readJson(request) {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
  });
}
