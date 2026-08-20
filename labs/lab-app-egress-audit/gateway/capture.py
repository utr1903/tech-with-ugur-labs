"""mitmproxy addon: record the three egress visibility layers to JSONL.

mitmproxy loads this file via `-s capture.py`, imports it in-process, and for
every object in the module-level `addons` list calls the method named after
each lifecycle event as it happens. We never run this script ourselves.

Three events, one per visibility layer, each appended as one JSON line:

- tls_clienthello   -> the SNI of every TLS connection, decryptable or not.
                       Fires as soon as the ClientHello is parsed, before any
                       certificate has been presented.
- request           -> the fully decrypted HTTP request (method, path, body)
                       for connections whose forged cert the app accepted.
- tls_failed_client -> the app aborted the handshake after seeing our forged
                       cert (certificate pinning). The payload stays opaque,
                       but the SNI captured earlier still names the destination.

The analyzer folds these lines into one evidence record per hostname.
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
        # tls_failed_client only identifies the client connection, not the
        # hostname, so remember each connection's SNI to attribute failures.
        self._sni_by_client = {}

    def tls_clienthello(self, data):
        sni = data.client_hello.sni
        self._sni_by_client[data.context.client.id] = sni
        _write({"event": "clienthello", "sni": sni})

    def request(self, flow):
        # Reached only if the client completed TLS with us, i.e. trusted our CA.
        # pretty_host prefers the Host header / SNI over the raw destination IP.
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
        # The client saw our forged cert and hung up: the signature of pinning.
        sni = self._sni_by_client.get(data.context.client.id)
        _write({"event": "tls_failed_client", "sni": sni})


addons = [Capture()]
