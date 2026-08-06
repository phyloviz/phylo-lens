FROM phyloviz/phylolib@sha256:f1cc154814efdf45cd38b3ae13e0434e74a7b6ee5ab0b31679e822841fbc5e17

ARG VERSION=0.1.1

LABEL org.opencontainers.image.title="PhyloLens API service" \
      org.opencontainers.image.description="Computational API service for PhyloLens prepared layouts and viewport reads" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.base.name="phyloviz/phylolib@sha256:f1cc154814efdf45cd38b3ae13e0434e74a7b6ee5ab0b31679e822841fbc5e17" \
      org.phylolens.phylolib.jar.path="/app/phylolib.jar"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:/opt/java/openjdk/bin:$PATH \
    PHYLO_LENS_DATA_DIR=/data \
    PHYLO_LENS_HOST=0.0.0.0 \
    PHYLO_LENS_PORT=8000 \
    PHYLO_LENS_PHYLOLIB_JAR=/app/phylolib.jar \
    PHYLO_LENS_PHYLOLIB_JAVA=/opt/java/openjdk/bin/java

WORKDIR /app

RUN apk add --no-cache graphviz python3 py3-pip \
    && python3 -m venv /opt/venv \
    && /opt/java/openjdk/bin/java -version \
    && sfdp -V

COPY pyproject.toml README.md ./
COPY src ./src
COPY sql ./sql

RUN pip install --no-cache-dir '.[postgres]'

RUN addgroup -S phylo-lens \
    && adduser -S -G phylo-lens -h /nonexistent -s /sbin/nologin phylo-lens \
    && mkdir -p /data \
    && chown -R phylo-lens:phylo-lens /data

USER phylo-lens

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import json, os, urllib.request; port=os.environ.get('PHYLO_LENS_PORT','8000'); response=urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3); raise SystemExit(0 if json.load(response).get('status') == 'ok' else 1)"]

ENTRYPOINT []
CMD ["python", "-m", "phylo_lens_server.serve"]
