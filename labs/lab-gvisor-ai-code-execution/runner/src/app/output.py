"""The only protocol writer; chunks are data, never trusted status."""

from __future__ import annotations

import base64
import json
import sys


def write_record(record: dict[str, object]) -> None:
    """Flush a complete bounded JSON frame."""
    sys.stdout.write(
        json.dumps({"captureVersion": 1, **record}, separators=(",", ":")) + "\n"
    )
    sys.stdout.flush()


def write_chunk(stream: str, data: bytes) -> None:
    """Write at most 1024 raw bytes per data frame."""
    write_record({"stream": stream, "dataB64": base64.b64encode(data).decode("ascii")})
