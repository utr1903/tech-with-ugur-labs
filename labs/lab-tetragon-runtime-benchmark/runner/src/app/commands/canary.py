"""Proves the event pipeline works: a known exec must show up within seconds."""

from __future__ import annotations

import time

from app.errors import ExpectationError
from app.kube.events import EventStream
from app.kube.kubectl import kubectl
from app.logging_setup import Logger

DEADLINE_S = 5.0
_BINARY = "/tmp/hello"


def _seen(stream: EventStream) -> bool:
    return any(
        e.kind == "exec" and e.pod == "victim" and e.binary == _BINARY
        for e in stream.snapshot()
    )


def _require_seen(stream: EventStream) -> None:
    if not _seen(stream):
        raise ExpectationError(
            f"no process_exec for {_BINARY} in pod victim within "
            f"{DEADLINE_S:.0f}s; the event pipeline is not working"
        )


def run(*, log: Logger) -> None:
    """Executes /tmp/hello in victim and expects its process_exec event."""
    try:
        log.info("Running canary...", binary=_BINARY)
        with EventStream(log=log) as stream:
            kubectl(
                [
                    "exec",
                    "-n",
                    "victim",
                    "victim",
                    "--",
                    "sh",
                    "-c",
                    f"printf '#!/bin/sh\\ntrue\\n' > {_BINARY} && "
                    f"chmod +x {_BINARY} && {_BINARY}",
                ],
                log=log,
            )
            deadline = time.monotonic() + DEADLINE_S
            while time.monotonic() < deadline and not _seen(stream):
                time.sleep(0.25)
            _require_seen(stream)
    except Exception:
        log.exception("Running canary failed.", binary=_BINARY)
        raise
    else:
        log.info("Running canary succeeded.", binary=_BINARY)
