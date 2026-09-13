"""Reads a subprocess pipe to EOF while keeping only the first N bytes."""

from __future__ import annotations

import asyncio

from app.execution.models import CapturedText

_READ_SIZE = 65536


class BoundedCapture:
    """Drains a stream completely so the child never blocks on a full pipe.

    Bytes beyond `limit` are discarded; `snapshot()` works mid-stream so a
    caller that gives up waiting still gets what arrived.
    """

    def __init__(self, *, limit: int) -> None:
        self._limit = limit
        self._kept = bytearray()
        self._truncated = False

    async def drain(self, stream: asyncio.StreamReader) -> None:
        """Reads until EOF."""
        while chunk := await stream.read(_READ_SIZE):
            room = self._limit - len(self._kept)
            if room > 0:
                self._kept.extend(chunk[:room])
            if len(chunk) > max(room, 0):
                self._truncated = True

    def snapshot(self) -> CapturedText:
        """What has been kept so far."""
        return CapturedText(
            text=self._kept.decode("utf-8", errors="replace"),
            truncated=self._truncated,
        )
