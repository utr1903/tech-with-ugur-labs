"""Server-sent events parsing for the Hermes run stream."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator

from app.errors import HermesError


def parse_sse(lines: Iterable[str]) -> Iterator[dict[str, object]]:
    """Yields the JSON payload of every `data:` frame in an SSE stream.

    Input is an iterable of text pieces that each hold whole lines, such as
    `httpx.Response.iter_lines()` (one line per item, no newline) or a chunk
    containing several lines. A piece must not end mid-line. A frame ends at
    a blank line; comment lines (`: keepalive`, `: stream closed`) and the
    `id:`/`event:` fields are ignored. A trailing frame without its closing
    blank line is still delivered.
    """
    data: list[str] = []
    for piece in lines:
        for line in piece.split("\n"):
            line = line.rstrip("\r")
            if line == "":
                if data:
                    yield _decode(data)
                    data = []
            elif line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
    if data:
        yield _decode(data)


def _decode(data: list[str]) -> dict[str, object]:
    try:
        payload = json.loads("\n".join(data))
    except json.JSONDecodeError as err:
        raise HermesError("Run stream sent a frame that is not JSON.") from err
    if not isinstance(payload, dict):
        raise HermesError("Run stream sent a frame that is not a JSON object.")
    return payload
