#!/bin/sh
set -eu

# Route ALL egress through the gateway container. The app itself is never told
# about a proxy — we redirect it at the network layer, exactly as an inspection
# gateway would in front of an uncooperative binary.
ip route replace default via "${GATEWAY_IP:-10.10.1.2}"

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

# Trust the mitmproxy CA so the benign + beacon calls decrypt. This is the
# real-world equivalent of the gateway pushing its CA into the app's trust store.
export NODE_EXTRA_CA_CERTS="${MITM_CA_PATH:-/certs/mitmproxy-ca-cert.pem}"

exec npm start
