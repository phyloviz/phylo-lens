#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-phylo-lens-service:local}"
CONTAINER_NAME="${CONTAINER_NAME:-phylo-lens-service-smoke}"
PORT="${PORT:-18080}"
SKIP_BUILD="${SKIP_BUILD:-0}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-}"
PHYLOLIB_JAR_SHA256_FILE="${PHYLOLIB_JAR_SHA256_FILE:-phylolib.jar.sha256}"
PHYLOLIB_JAR_SHA256="${PHYLOLIB_JAR_SHA256:-}"
export PORT

if [ -z "$PHYLOLIB_JAR_SHA256" ]; then
  PHYLOLIB_JAR_SHA256="$(tr -d '[:space:]' < "$PHYLOLIB_JAR_SHA256_FILE")"
fi

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

cleanup
if [ "$SKIP_BUILD" != "1" ]; then
  if [ -n "$DOCKER_PLATFORM" ]; then
    docker build --platform "$DOCKER_PLATFORM" -t "$IMAGE_NAME" .
  else
    docker build -t "$IMAGE_NAME" .
  fi
fi

if [ -n "$DOCKER_PLATFORM" ]; then
  docker run -d \
    --platform "$DOCKER_PLATFORM" \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:8000" \
    -e PHYLO_LENS_DATA_DIR=/data \
    "$IMAGE_NAME" >/dev/null
else
  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:8000" \
    -e PHYLO_LENS_DATA_DIR=/data \
    "$IMAGE_NAME" >/dev/null
fi

trap cleanup EXIT

python - <<'PY'
import json
import os
import time
import urllib.error
import urllib.request

port = os.environ.get("PORT", "8000")
base_url = f"http://127.0.0.1:{port}"
request_timeout_seconds = int(os.environ.get("SMOKE_REQUEST_TIMEOUT_SECONDS", "60"))
poll_timeout_seconds = float(os.environ.get("SMOKE_POLL_TIMEOUT_SECONDS", "10"))

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
        response = urllib.request.urlopen(request, timeout=request_timeout_seconds)
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
            f"{base_url}/api/graph/prepare/{job['job_id']}", timeout=poll_timeout_seconds
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
with urllib.request.urlopen(request, timeout=request_timeout_seconds) as response:
    viewport = json.load(response)

if not viewport.get("nodes"):
    raise SystemExit(f"Viewport smoke returned no nodes: {viewport}")

if typing_result["node_count"] < 3:
    raise SystemExit(f"Typing-data smoke returned too few nodes: {typing_result}")

print("container smoke ok")
PY

docker exec "$CONTAINER_NAME" sfdp -V
docker exec "$CONTAINER_NAME" java -version
docker exec "$CONTAINER_NAME" python -c 'import psycopg'
docker exec "$CONTAINER_NAME" sh -c 'test -r "$PHYLO_LENS_PHYLOLIB_JAR"'
docker exec "$CONTAINER_NAME" sh -c "echo '$PHYLOLIB_JAR_SHA256  '\$PHYLO_LENS_PHYLOLIB_JAR | sha256sum -c -"
docker exec "$CONTAINER_NAME" sh -c 'java -jar "$PHYLO_LENS_PHYLOLIB_JAR" 2>&1 | grep -q "No command has been specified"'
