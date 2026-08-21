#!/bin/sh
set -eu

# Add the two alias IPs so this one container also answers as the attacker
# sinks. The base IP 10.10.0.10 is assigned by compose; .11 and .12 are added
# to the same interface here (needs NET_ADMIN).
IFACE="$(ip -o -4 route show to default | awk '{print $5}')"
[ -n "$IFACE" ] || IFACE=eth0
ip addr add 10.10.0.11/24 dev "$IFACE" || true
ip addr add 10.10.0.12/24 dev "$IFACE" || true

# One self-signed cert whose SANs cover every hostname this box impersonates.
# The private key stays container-local; only the public cert goes to /certs.
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/webhost-key.pem \
  -out /certs/webhost-cert.pem \
  -days 3650 -subj "/CN=lab-webhost" \
  -addext "subjectAltName=DNS:updates.goodvendor.lab,DNS:cdn-metrics.tracklab.lab,DNS:telemetry.adnexus.lab"

exec python3 server.py
