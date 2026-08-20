#!/bin/sh
set -eu

# --- 1. Firewall rules: bend the suspect app's traffic into mitmproxy ---------
#
# The suspect app runs in THIS container's network namespace (compose
# `network_mode: service:gateway`). Its outbound TCP is therefore generated
# locally, so it passes through the nat table's OUTPUT chain before leaving the
# box — the chain for packets created by local processes (PREROUTING would be
# the one for packets arriving from other hosts).
#
# Rules are evaluated top to bottom:
#   1. Packets owned by the `mitmproxy` user leave the chain untouched (RETURN).
#      These are mitmproxy's own upstream connections to the webhost; without
#      this exemption they would be redirected back into mitmproxy forever.
#   2./3. Every other TCP packet to port 80 or 443 has its destination rewritten
#      to local port 8080, where mitmproxy listens. The sending process is not
#      told; its socket still believes it is connected to the original host.
MITM_UID="$(id -u mitmproxy)"
iptables -t nat -A OUTPUT -p tcp -m owner --uid-owner "$MITM_UID" -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-ports 8080

# --- 2. Drop privileges ---------------------------------------------------------
# mitmproxy must run as the `mitmproxy` user for rule 1 to match, so it needs to
# own the directories it writes to: /certs (its CA) and /capture (our addon's log).
mkdir -p /capture /certs
chown mitmproxy:mitmproxy /capture /certs

# --- 3. Run mitmproxy in transparent mode ---------------------------------------
#   --mode transparent   accept redirected connections; ask the kernel for the
#                        original destination (SO_ORIGINAL_DST) instead of
#                        expecting a CONNECT request from a configured client.
#   --showhost           name flows by SNI / Host header, not by IP — all lab
#                        hostnames share the webhost's single IP.
#   --ssl-insecure       the webhost's certificate is self-signed; accept it on
#                        the upstream leg.
#   connection_strategy=lazy
#                        finish the TLS handshake with the client BEFORE opening
#                        the upstream connection. This guarantees we see the SNI
#                        and present our forged cert even to the pinned
#                        connection, which rejects it before any upstream exists.
#   confdir=/certs       generate the CA on the shared volume so the suspect app
#                        can add it to its trust store.
#   -s capture.py        our addon: writes the three evidence layers as JSONL.
#   -q                   quiet console; the addon is the output.
exec runuser -u mitmproxy -- mitmdump \
  --mode transparent \
  --showhost \
  --ssl-insecure \
  --set connection_strategy=lazy \
  --set confdir=/certs \
  -s /addon/capture.py \
  -q
