#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-phylo-lens-service:local}"
CONTAINER_NAME="${CONTAINER_NAME:-phylo-lens-service-smoke}"
PORT="${PORT:-18080}"
SKIP_BUILD="${SKIP_BUILD:-0}"
export PORT

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

cleanup
if [ "$SKIP_BUILD" != "1" ]; then
  docker build -t "$IMAGE_NAME" .
fi
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:8000" \
  -e PHYLO_LENS_DATA_DIR=/data \
  "$IMAGE_NAME" >/dev/null

trap cleanup EXIT

python - <<'PY'
import json
import os
import time
import urllib.error
import urllib.request

port = os.environ.get("PORT", "8000")
base_url = f"http://127.0.0.1:{port}"

for _ in range(60):
    try:
        with urllib.request.urlopen(f"{base_url}/health", timeout=2) as response:
            body = json.load(response)
        if (
            body.get("status") == "ok"
            and body.get("api_version") == "1"
            and isinstance(body.get("service_version"), str)
        ):
            break
    except (OSError, urllib.error.URLError):
        pass
    time.sleep(1)
else:
    raise SystemExit("Timed out waiting for /health")

def prepare(payload):
    request = urllib.request.Request(
        f"{base_url}/api/graph/prepare",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"Prepare failed for {payload['format']} with HTTP {error.code}: {body}"
        ) from error

    with response:
        if response.status != 202:
            raise SystemExit(f"Expected prepare status 202, got {response.status}")
        job = json.load(response)

    for _ in range(120):
        with urllib.request.urlopen(
            f"{base_url}/api/graph/prepare/{job['job_id']}", timeout=5
        ) as response:
            status = json.load(response)
        if status["status"] != "pending":
            break
        time.sleep(0.25)
    else:
        raise SystemExit("Prepare job did not finish")

    if status["status"] != "ready":
        raise SystemExit(f"Prepare failed: {status}")

    return status["result"]


result = prepare(
    {
        "format": "newick",
        "dataset_name": "container-smoke",
        "content": "(((d:4)c:2)b:1)a;",
    }
)

typing_result = prepare(
    {
        "format": "typing_data",
        "dataset_name": "container-smoke-typing",
        "content": "ST\tadk\tfumC\n1\t1\t2\n2\t1\t3\n3\t4\t5\n",
    }
)

viewport_payload = {
    "dataset_id": result["dataset_id"],
    "layout_version": result["layout_version"],
    "lod_level": 0,
    "max_nodes": 50,
}
request = urllib.request.Request(
    f"{base_url}/api/graph/viewport",
    data=json.dumps(viewport_payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=10) as response:
    viewport = json.load(response)

if not viewport.get("nodes"):
    raise SystemExit(f"Viewport smoke returned no nodes: {viewport}")

if typing_result["node_count"] < 3:
    raise SystemExit(f"Typing-data smoke returned too few nodes: {typing_result}")

print("container smoke ok")
PY

docker exec "$CONTAINER_NAME" sfdp -V
docker exec "$CONTAINER_NAME" java -version
docker exec "$CONTAINER_NAME" sh -c 'test -r "$PHYLO_LENS_PHYLOLIB_JAR"'
docker exec "$CONTAINER_NAME" sh -c 'sha256sum "$PHYLO_LENS_PHYLOLIB_JAR"'
docker exec "$CONTAINER_NAME" sh -c 'java -jar "$PHYLO_LENS_PHYLOLIB_JAR" 2>&1 | grep -q "No command has been specified"'
