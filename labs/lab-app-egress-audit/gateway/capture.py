"""mitmproxy addon: record the three egress visibility layers to JSONL.

- tls_clienthello: the SNI of every TLS connection, decryptable or not.
- request: fully decrypted HTTP for connections whose cert the app trusted.
- tls_failed_client: the app rejected our forged cert (certificate pinning) —
  the connection stays opaque, but the SNI is still a finding.
"""

import json
import os
import threading

LOG = os.environ.get("CAPTURE_LOG", "/capture/capture.jsonl")
_lock = threading.Lock()


def _write(record):
    with _lock:
        with open(LOG, "a") as fh:
            fh.write(json.dumps(record) + "\n")
            fh.flush()


class Capture:
    def __init__(self):
        self._sni_by_client = {}

    def tls_clienthello(self, data):
        sni = data.client_hello.sni
        self._sni_by_client[data.context.client.id] = sni
        _write({"event": "clienthello", "sni": sni})

    def request(self, flow):
        _write(
            {
                "event": "request",
                "host": flow.request.pretty_host,
                "method": flow.request.method,
                "path": flow.request.path,
                "body": flow.request.get_text(strict=False),
            }
        )

    def tls_failed_client(self, data):
        sni = self._sni_by_client.get(data.context.client.id)
        _write({"event": "tls_failed_client", "sni": sni})


addons = [Capture()]
