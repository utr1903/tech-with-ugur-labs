"""Attacker-side sinks: HTTP tool server (8080), reverse-shell (4444) and stratum (3333) listeners."""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

TOOL = b"#!/bin/sh\nmkdir -p /tmp/bench && touch /tmp/bench/02.done\n"


def log(sink: str, peer: object) -> None:
    print(json.dumps({"sink": sink, "peer": str(peer), "time_ms": int(time.time() * 1000)}), flush=True)


class Http(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        log("http", self.client_address[0])
        body = TOOL if self.path == "/tool" else b"ok\n"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        log("http", self.client_address[0])
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return


def make_handler(sink: str, greeting: bytes) -> Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        log(sink, writer.get_extra_info("peername"))
        writer.write(greeting)
        await writer.drain()
        try:
            await asyncio.wait_for(reader.readline(), timeout=2)
        except TimeoutError:
            pass
        writer.close()

    return handle


async def main() -> None:
    Thread(target=ThreadingHTTPServer(("0.0.0.0", 8080), Http).serve_forever, daemon=True).start()
    servers = [
        await asyncio.start_server(make_handler("revshell", b"id\n"), "0.0.0.0", 4444),
        await asyncio.start_server(make_handler("stratum", b""), "0.0.0.0", 3333),
    ]
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    asyncio.run(main())
