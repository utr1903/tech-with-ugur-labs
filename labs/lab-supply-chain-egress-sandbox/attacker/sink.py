"""Attacker sink: log any credentials POSTed here to the evidence volume."""

import http.server
import os

EVIDENCE = os.environ.get("EVIDENCE", "/evidence/attacker.log")


class Sink(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        os.makedirs(os.path.dirname(EVIDENCE), exist_ok=True)
        with open(EVIDENCE, "a") as fh:
            fh.write(body.decode("utf-8", "replace") + "\n")
        print("attacker: RECEIVED", body, flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok\n")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.HTTPServer(("0.0.0.0", 9000), Sink).serve_forever()
