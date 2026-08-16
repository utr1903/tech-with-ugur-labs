"""A tiny stdlib forward proxy that logs and allow-lists egress.

Because every hop in this lab is plain HTTP, the proxy only ever sees
absolute-URI GET/HEAD/POST requests — never CONNECT — which keeps it small
and fully legible. Requests to allow-listed hosts are forwarded and streamed
back; everything else is refused with 403 and logged with its target host.
"""

import http.server
import os
import socketserver
import urllib.parse
import urllib.request

ALLOW = set(
    h.strip() for h in os.environ.get("ALLOW_HOSTS", "mirror").split(",") if h.strip()
)
EVIDENCE = os.environ.get("EVIDENCE", "/evidence/proxy.log")

# Force DIRECT origin connections from the proxy itself: never chain proxies.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def parse_target(path):
    parts = urllib.parse.urlsplit(path)
    host = parts.hostname
    port = parts.port or 80
    tail = urllib.parse.urlunsplit(("", "", parts.path or "/", parts.query, ""))
    return host, port, tail


def is_allowed(host, allow):
    return host in allow


def _log(line):
    os.makedirs(os.path.dirname(EVIDENCE), exist_ok=True)
    with open(EVIDENCE, "a") as fh:
        fh.write(line + "\n")
    print("proxy:", line, flush=True)


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def _dispatch(self, method):
        host, port, tail = parse_target(self.path)
        if not is_allowed(host, ALLOW):
            _log(f"DENY {method} host={host} port={port}")
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"blocked by egress sandbox\n")
            return
        _log(f"ALLOW {method} host={host} port={port}")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            f"http://{host}:{port}{tail}", data=body, method=method
        )
        for key, value in self.headers.items():
            if key.lower() in ("host", "connection", "proxy-connection", "content-length"):
                continue
            req.add_header(key, value)
        try:
            with _opener.open(req, timeout=30) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    if key.lower() in ("transfer-encoding", "connection", "content-length"):
                        continue
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if method != "HEAD":
                    self.wfile.write(payload)
        except Exception as exc:  # origin unreachable / error
            _log(f"ERROR {method} host={host} {exc}")
            self.send_response(502)
            self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    Server(("0.0.0.0", 8080), Proxy).serve_forever()
