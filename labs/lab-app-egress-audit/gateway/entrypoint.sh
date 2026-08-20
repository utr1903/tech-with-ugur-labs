#!/bin/sh
set -eu

# Shared-namespace transparent interception. The suspect app runs in THIS
# container's network namespace (compose `network_mode: service:gateway`), so its
# outbound TCP is generated locally and hits the OUTPUT chain. We redirect its
# tcp 80/443 to mitmproxy's transparent listener on 8080, while mitmproxy's OWN
# upstream connections (owned by the mitmproxy user) are excluded so they are not
# looped back into the proxy.
MITM_UID="$(id -u mitmproxy)"
iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner "$MITM_UID" -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-ports 8080

# mitmproxy runs as the mitmproxy user, so it needs to own its config + capture dirs.
mkdir -p /capture /certs
chown mitmproxy:mitmproxy /capture /certs

# lazy connection strategy: do the client-side TLS first so we always capture
# the SNI and present our forged cert — even for the pinned connection, which
# the app rejects before any upstream is contacted.
exec runuser -u mitmproxy -- mitmdump \
  --mode transparent \
  --showhost \
  --ssl-insecure \
  --set connection_strategy=lazy \
  --set confdir=/certs \
  -s /addon/capture.py \
  -q
