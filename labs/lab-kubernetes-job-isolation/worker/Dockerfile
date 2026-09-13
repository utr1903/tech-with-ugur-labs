FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node
FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home --shell /bin/sh runner \
    && mkdir -p /home/runner/data /opt/worker \
    && chown runner:runner /home/runner/data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY worker/launcher.mjs worker/operations.mjs worker/configuration.mjs worker/result-files.mjs /opt/worker/
ENV HOME=/home/runner OUTPUT_LIMIT_BYTES=65536
WORKDIR /home/runner
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/node", "/opt/worker/launcher.mjs"]
