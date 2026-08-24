#!/bin/sh
set -eu

# This container is NOT told about any proxy and gets no extra CA and no
# capabilities. Its only network configuration is the compose `dns:` pointing
# at the lab resolver (network provisioning, like DHCP — not app cooperation).
# It waits for the vendor's published cert so its own HTTPS calls can trust it.
echo "suspect-app: waiting for the vendor cert..."
i=0
while [ ! -f "${VENDOR_CERT_PATH:-/certs/webhost-cert.pem}" ]; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && echo "suspect-app: vendor cert never appeared" && exit 1
  sleep 1
done

exec npm start
