"""Rebuilds the committed snapshot from the live Open-Meteo endpoints."""

from __future__ import annotations

from app import config
from app.data import openmeteo
from app.logging_setup import Logger


def run(*, log: Logger) -> None:
    """Rebuilds the committed snapshot from the live endpoints."""
    try:
        log.info(
            "Fetching the snapshot...",
            start=config.FETCH_START,
            end=config.FETCH_END,
        )
        frame = openmeteo.fetch_snapshot()
        openmeteo.write_snapshot(frame, config.SNAPSHOT_PATH)
    except Exception:
        log.exception(
            "Fetching the snapshot failed.",
            start=config.FETCH_START,
            end=config.FETCH_END,
        )
        raise
    else:
        log.info(
            "Fetching the snapshot succeeded.",
            rows=len(frame),
            path=str(config.SNAPSHOT_PATH),
        )
