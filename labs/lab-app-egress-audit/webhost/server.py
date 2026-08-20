"""Lab webhost: plays the vendor update endpoint AND the attacker sink.

dnsmasq resolves every *.lab name to this container, so it answers as
updates.goodvendor.lab, both beacon sinks and pin.evil-c2.lab at once, using
the multi-SAN certificate generated in entrypoint.sh.

Every request is answered 200. The point of this container is to be a
believable destination so the suspect app's connections complete; the
*evidence* about what was said to it comes from the gateway's decryption, not
from here — which is why it deliberately logs nothing.
"""

import http.server
import json
import ssl

CERT = "/certs/webhost-cert.pem"
KEY = "/tmp/webhost-key.pem"  # private key stays container-local


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, b'{"ok":true}')
        if self.path.startswith("/version"):
            return self._send(200, json.dumps({"latest": "1.2.3"}).encode())
        return self._send(200, b"{}")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        if length:
            self.rfile.read(length)
        self._send(200, b'{"ok":true}')

    def log_message(self, *args):
        pass


def main():
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 443), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=CERT, keyfile=KEY)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print("webhost: serving TLS on :443", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
