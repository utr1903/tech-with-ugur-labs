#!/bin/sh
set -eu

# Transparent redirect: any tcp 80/443 that the suspect app routes through this
# gateway is sent to mitmproxy's transparent listener on 8080. mitmproxy reads
# the original destination from the kernel (SO_ORIGINAL_DST). mitmproxy's own
# upstream connections are locally generated (OUTPUT chain), so they are NOT
# matched by this PREROUTING rule and need no uid exclusion.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 8080

mkdir -p /capture

# lazy connection strategy: do the client-side TLS first so we always capture
# the SNI and present our forged cert — even for the pinned connection, which
# the app rejects before any upstream is contacted.
exec mitmdump \
  --mode transparent \
  --showhost \
  --ssl-insecure \
  --set connection_strategy=lazy \
  --set confdir=/certs \
  -s /addon/capture.py \
  -q
