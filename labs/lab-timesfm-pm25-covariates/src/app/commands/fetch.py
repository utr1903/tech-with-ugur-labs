"""Rebuilds the committed snapshot from the live Open-Meteo endpoints."""

from __future__ import annotations

from app import config
from app.data import openmeteo


def run() -> int:
    """Rebuilds the committed snapshot from the live endpoints."""
    print(f"fetching {config.FETCH_START}..{config.FETCH_END} for Milan")
    frame = openmeteo.fetch_snapshot()
    openmeteo.write_snapshot(frame, config.SNAPSHOT_PATH)
    print(f"wrote {len(frame)} rows to {config.SNAPSHOT_PATH}")
    return 0
