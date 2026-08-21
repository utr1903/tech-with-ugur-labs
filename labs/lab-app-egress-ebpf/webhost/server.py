"""Lab webhost: the vendor update endpoint AND both attacker beacon sinks.

dnsmasq resolves each *.lab name to a distinct IP (10.10.0.10/.11/.12); the
entrypoint adds .11 and .12 as alias addresses so this single container answers
on all three. It uses one multi-SAN certificate. Every request is answered 200;
the point is to be a believable destination so the app's connections complete.
The *evidence* about who connected comes from the kernel sensor, not from here,
which is why this deliberately logs nothing.
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
