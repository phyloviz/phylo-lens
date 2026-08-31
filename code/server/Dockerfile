FROM phyloviz/phylolib@sha256:f1cc154814efdf45cd38b3ae13e0434e74a7b6ee5ab0b31679e822841fbc5e17 AS graphviz-build

ARG GRAPHVIZ_VERSION=12.2.1
ARG GRAPHVIZ_SHA256=242bc18942eebda6db4039f108f387ec97856fc91ba47f21e89341c34b554df8
ARG GTS_VERSION=0.7.6
ARG GTS_SHA256=059c3e13e3e3b796d775ec9f96abdce8f2b3b5144df8514eda0cc12e13e8b81e

# Alpine's prebuilt Graphviz omits GTS, which makes sfdp's configured overlap
# removal fail at runtime. Alpine does not package GTS, so build its pinned
# upstream source first, then build Graphviz against it. GTS 0.7.6's 2005
# config.guess predates aarch64; config.sub accepts the explicit canonical
# Linux build triplet used below on both supported container architectures.
RUN apk add --no-cache \
        build-base \
        ca-certificates \
        curl \
        glib-dev \
        libtool \
        pkgconf \
    && curl --fail --location --silent --show-error \
        --output /tmp/gts.tar.gz \
        "https://sourceforge.net/projects/gts/files/gts/${GTS_VERSION}/gts-${GTS_VERSION}.tar.gz/download" \
    && echo "${GTS_SHA256}  /tmp/gts.tar.gz" | sha256sum -c - \
    && mkdir -p /tmp/gts-source \
    && tar -xzf /tmp/gts.tar.gz -C /tmp/gts-source --strip-components=1 \
    && cd /tmp/gts-source \
    && ./configure --build="$(uname -m)-unknown-linux-gnu" --prefix=/opt/gts --disable-static \
    && make -j"$(getconf _NPROCESSORS_ONLN)" \
    && make install \
    && curl --fail --location --silent --show-error \
        --output /tmp/graphviz.tar.gz \
        "https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/${GRAPHVIZ_VERSION}/graphviz-${GRAPHVIZ_VERSION}.tar.gz" \
    && echo "${GRAPHVIZ_SHA256}  /tmp/graphviz.tar.gz" | sha256sum -c - \
    && mkdir -p /tmp/graphviz-source \
    && tar -xzf /tmp/graphviz.tar.gz -C /tmp/graphviz-source --strip-components=1 \
    && cd /tmp/graphviz-source \
    && PKG_CONFIG_PATH=/opt/gts/lib/pkgconfig ./configure --prefix=/opt/graphviz --with-gts=yes \
    && make -j"$(getconf _NPROCESSORS_ONLN)" \
    && make install-strip \
    && rm -rf /tmp/gts.tar.gz /tmp/gts-source /tmp/graphviz.tar.gz /tmp/graphviz-source

FROM phyloviz/phylolib@sha256:f1cc154814efdf45cd38b3ae13e0434e74a7b6ee5ab0b31679e822841fbc5e17

ARG VERSION=0.2.1
ARG GRAPHVIZ_VERSION=12.2.1

LABEL org.opencontainers.image.title="PhyloLens API service" \
      org.opencontainers.image.description="Computational API service for PhyloLens prepared layouts and viewport reads" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.base.name="phyloviz/phylolib@sha256:f1cc154814efdf45cd38b3ae13e0434e74a7b6ee5ab0b31679e822841fbc5e17" \
      org.phylolens.phylolib.jar.path="/app/phylolib.jar"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/graphviz/bin:/opt/venv/bin:/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LD_LIBRARY_PATH=/opt/graphviz/lib:/opt/gts/lib \
    PHYLO_LENS_GRAPHVIZ_VERSION=${GRAPHVIZ_VERSION} \
    PHYLO_LENS_DATA_DIR=/data \
    PHYLO_LENS_HOST=0.0.0.0 \
    PHYLO_LENS_PORT=8000 \
    PHYLO_LENS_PHYLOLIB_JAR=/app/phylolib.jar \
    PHYLO_LENS_PHYLOLIB_JAVA=/opt/java/openjdk/bin/java

WORKDIR /app

RUN apk add --no-cache glib libltdl python3 py3-pip \
    && python3 -m venv /opt/venv \
    && /opt/java/openjdk/bin/java -version

COPY --from=graphviz-build /opt/gts /opt/gts
COPY --from=graphviz-build /opt/graphviz /opt/graphviz
COPY scripts/graphviz-capability-smoke.sh /usr/local/bin/graphviz-capability-smoke

RUN chmod +x /usr/local/bin/graphviz-capability-smoke \
    && /bin/sh /usr/local/bin/graphviz-capability-smoke

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
