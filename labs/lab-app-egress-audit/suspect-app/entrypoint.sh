#!/bin/sh
set -eu

# This container shares the gateway's network namespace (compose
# `network_mode: service:gateway`), so every packet it sends passes through the
# gateway's iptables rules and is redirected into mitmproxy. The app is never
# told about a proxy. A side effect of the shared namespace is that Docker's
# embedded DNS is unavailable, so point the resolver at dnsmasq by IP: every
# lookup gets logged there and every .lab name resolves to the webhost.
echo "nameserver ${DNS_IP:-10.10.0.3}" > /etc/resolv.conf

# Wait for the gateway to publish its CA (trusted for the decryptable calls) and
# for the vendor's real leaf cert (used to pin the C2 connection).
echo "suspect-app: waiting for certs..."
i=0
while [ ! -f "${MITM_CA_PATH:-/certs/mitmproxy-ca-cert.pem}" ] \
   || [ ! -f "${PINNED_CERT_PATH:-/certs/webhost-cert.pem}" ]; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && echo "suspect-app: certs never appeared" && exit 1
  sleep 1
done

# Add the mitmproxy CA to Node's trust store so the update check and the beacons
# accept the gateway's forged certificates and can be decrypted. This is the
# real-world step of pushing the gateway CA into a fleet's trust stores (MDM,
# group policy). Without it every row in the report would be SNI-only. The
# pinned connection ignores the trust store entirely, which is why it stays
# opaque regardless.
export NODE_EXTRA_CA_CERTS="${MITM_CA_PATH:-/certs/mitmproxy-ca-cert.pem}"

exec npm start
