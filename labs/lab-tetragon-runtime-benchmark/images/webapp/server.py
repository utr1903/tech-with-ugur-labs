"""A deliberately vulnerable web app: /run?cmd= executes whatever it is given.

It exists so the lab can demonstrate remote command execution. Never deploy it
anywhere real.
"""

import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path != "/run":
            self.respond(200, b"ok\n")
            return
        cmd = parse_qs(url.query).get("cmd", [""])[0]
        # INTENTIONALLY VULNERABLE: untrusted input goes straight to a shell.
        result = subprocess.run(cmd, shell=True, capture_output=True, timeout=30)
        out = result.stdout.decode(errors="replace")
        self.respond(200, json.dumps({"rc": result.returncode, "out": out}).encode())

    def respond(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
