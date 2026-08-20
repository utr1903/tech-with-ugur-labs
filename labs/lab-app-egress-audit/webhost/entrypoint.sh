#!/bin/sh
set -eu

# Generate a self-signed multi-SAN cert covering every lab vhost. The private
# key stays in /tmp (container-local); only the public cert is published to the
# shared volume so the suspect app can pin against the vendor's real cert.
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/webhost-key.pem \
  -out /certs/webhost-cert.pem \
  -days 3650 -subj "/CN=lab-webhost" \
  -addext "subjectAltName=DNS:updates.goodvendor.lab,DNS:cdn-metrics.tracklab.lab,DNS:telemetry.adnexus.lab,DNS:pin.evil-c2.lab"

exec python3 server.py
