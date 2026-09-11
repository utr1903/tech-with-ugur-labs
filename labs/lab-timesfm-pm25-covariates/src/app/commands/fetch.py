"""Rebuilds the committed snapshot from the live Open-Meteo endpoints."""

from __future__ import annotations

from app import config
from app.data import openmeteo
from app.logging_setup import Logger


def run(*, log: Logger) -> None:
    """Rebuilds the committed snapshot from the live endpoints."""
    frame = openmeteo.fetch_snapshot(log=log)
    openmeteo.write_snapshot(frame, config.SNAPSHOT_PATH, log=log)
