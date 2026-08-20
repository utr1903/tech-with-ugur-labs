#!/bin/sh
set -eu

# Generate one self-signed certificate whose Subject Alternative Names cover
# every hostname the lab impersonates, so a single server is valid for all four.
#
# The private key stays in /tmp (container-local). Only the PUBLIC cert goes to
# the shared /certs volume: the suspect app reads it there and pins its C2
# connection to this exact certificate. Because mitmproxy never gets the key, it
# cannot forge a cert that satisfies the pin — which is the whole point.
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/webhost-key.pem \
  -out /certs/webhost-cert.pem \
  -days 3650 -subj "/CN=lab-webhost" \
  -addext "subjectAltName=DNS:updates.goodvendor.lab,DNS:cdn-metrics.tracklab.lab,DNS:telemetry.adnexus.lab,DNS:pin.evil-c2.lab"

exec python3 server.py
