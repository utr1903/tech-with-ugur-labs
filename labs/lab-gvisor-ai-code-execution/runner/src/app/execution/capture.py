"""Continuously drain pipes, coalesce frames and retain early diagnostics."""

from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time
from dataclasses import dataclass, field

from app.execution.limits import STREAM_BYTES, WALL_SECONDS
from app.output import write_chunk


@dataclass
class StreamCapture:
    """Bounded retained stream plus a bounded pending frame."""

    name: str
    data: bytearray = field(default_factory=bytearray)
    emitted: int = 0
    truncated: bool = False

    def accept(self, chunk: bytes) -> None:
        """Store only bounded bytes and discard the rest while draining."""
        remaining = STREAM_BYTES - len(self.data)
        self.data.extend(chunk[:remaining])
        self.truncated |= len(chunk) > remaining
        self.flush(full_only=True)
        if self.emitted == 0:
            self.flush()

    def flush(self, *, full_only: bool = False) -> None:
        """Emit full chunks immediately; emit one partial frame on close."""
        while len(self.data) - self.emitted >= 1024:
            write_chunk(self.name, bytes(self.data[self.emitted : self.emitted + 1024]))
            self.emitted += 1024
        if not full_only and self.emitted < len(self.data):
            write_chunk(self.name, bytes(self.data[self.emitted :]))
            self.emitted = len(self.data)


def drain(
    process: subprocess.Popen[bytes],
) -> tuple[StreamCapture, StreamCapture, bool]:
    """Drain until termination, with a total fixed wall bound."""
    stdout, stderr = StreamCapture("stdout"), StreamCapture("stderr")
    timed_out = False
    deadline = time.monotonic() + WALL_SECONDS
    with selectors.DefaultSelector() as selector:
        assert process.stdout is not None and process.stderr is not None
        for pipe, capture in ((process.stdout, stdout), (process.stderr, stderr)):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, capture)
        while selector.get_map():
            if time.monotonic() >= deadline:
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
                break
            for key, _ in selector.select(timeout=0.05):
                chunk = os.read(key.fd, 65536)
                capture = key.data
                if chunk:
                    capture.accept(chunk)
                else:
                    selector.unregister(key.fileobj)
                    capture.flush()
        for capture in (stdout, stderr):
            if capture.emitted == 0:
                capture.flush()
        for capture in (stdout, stderr):
            capture.flush()
    return stdout, stderr, timed_out
