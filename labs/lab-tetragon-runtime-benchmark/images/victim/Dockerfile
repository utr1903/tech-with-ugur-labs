FROM ubuntu:24.04@sha256:9c7f200c07e3d4a03e7249d2c16bf66a51120fb876aa2242cf31451412543289

# Packages come from a fixed Ubuntu snapshot so rebuilds are reproducible.
# The snapshot service is HTTPS-only and the base image has no CA bundle, so
# ca-certificates is bootstrapped from the default mirror first. The snapshot
# service serves both amd64 and arm64 under /ubuntu/.
ARG SNAPSHOT=20261101T000000Z
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -f /etc/apt/sources.list.d/ubuntu.sources \
    && printf 'Types: deb\nURIs: https://snapshot.ubuntu.com/ubuntu/%s/\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' "$SNAPSHOT" \
        > /etc/apt/sources.list.d/snapshot.sources \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl netcat-openbsd gcc libc6-dev kmod util-linux python3 procps \
    && rm -rf /var/lib/apt/lists/*

# Fake credentials, self-labelled. Not a secret.
RUN mkdir -p /var/log/app /build /etc/lab \
    && echo "LAB-CANARY-NOT-A-SECRET" > /etc/lab/credentials \
    && printf '#include <stdio.h>\nint main(void) { puts("hello"); return 0; }\n' > /build/hello.c

CMD ["sleep", "infinity"]
