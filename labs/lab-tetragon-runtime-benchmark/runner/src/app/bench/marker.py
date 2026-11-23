"""Reads the BENCH_ACTION marker a scenario script prints before acting."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.errors import MarkerMissingError

_MARKER = re.compile(r"^BENCH_ACTION (\d+)\s*$", re.MULTILINE)


def parse_marker(stdout: str) -> datetime:
    """Returns the time of the first marker line, in UTC."""
    found = _MARKER.search(stdout)
    if found is None:
        raise MarkerMissingError("scenario output has no BENCH_ACTION marker")
    return datetime.fromtimestamp(int(found.group(1)) / 1000, tz=UTC)
