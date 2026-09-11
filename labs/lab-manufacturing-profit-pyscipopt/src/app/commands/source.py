"""Read scenario bytes exactly once for parsing and provenance."""

from __future__ import annotations

from pathlib import Path

from app.errors import ScenarioError
from app.logging_setup import Logger


def read_input(path: Path, *, log: Logger) -> bytes:
    log.info("Reading input...", path=str(path))
    try:
        data = path.read_bytes()
    except OSError as err:
        log.exception("Reading input failed.", path=str(path))
        raise ScenarioError(f"scenario: could not read {path}") from err
    else:
        log.info("Reading input succeeded.", path=str(path), bytes=len(data))
        return data
