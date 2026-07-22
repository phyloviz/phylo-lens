FROM gonfrutuoso/phylolib@sha256:fddd67d0c00c1920c81b395155d13dfa99b546d6c7c47c6e92713e3a3fed834b

ARG VERSION=0.1.0

LABEL org.opencontainers.image.title="PhyloLens API service" \
      org.opencontainers.image.description="Computational API service for PhyloLens prepared layouts and viewport reads" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.base.name="gonfrutuoso/phylolib@sha256:fddd67d0c00c1920c81b395155d13dfa99b546d6c7c47c6e92713e3a3fed834b" \
      org.phylolens.phylolib.jar.path="/app.jar" \
      org.phylolens.phylolib.jar.sha256="36ae96903da88a2c41df6bdc266da0a2485f2278ecc473b60287c43e6163e70f"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:/opt/java/openjdk/bin:$PATH \
    PHYLO_LENS_DATA_DIR=/data \
    PHYLO_LENS_HOST=0.0.0.0 \
    PHYLO_LENS_PORT=8000 \
    PHYLO_LENS_PHYLOLIB_JAR=/app.jar \
    PHYLO_LENS_PHYLOLIB_JAVA=/opt/java/openjdk/bin/java

WORKDIR /app

RUN apk add --no-cache graphviz python3 py3-pip \
    && python3 -m venv /opt/venv \
    && /opt/java/openjdk/bin/java -version \
    && sfdp -V

COPY pyproject.toml README.md ./
COPY src ./src
COPY sql ./sql

RUN pip install --no-cache-dir .

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
