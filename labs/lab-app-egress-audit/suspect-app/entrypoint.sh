#!/bin/sh
set -eu

# We share the gateway's network namespace, so all of our egress is transparently
# redirected into mitmproxy — the app is never told about a proxy. Point our
# resolver at the lab DNS so every lookup is logged and every .lab name resolves
# to the webhost.
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

# Trust the mitmproxy CA so the benign + beacon calls decrypt. This is the
# real-world equivalent of the gateway pushing its CA into the app's trust store.
export NODE_EXTRA_CA_CERTS="${MITM_CA_PATH:-/certs/mitmproxy-ca-cert.pem}"

exec npm start
