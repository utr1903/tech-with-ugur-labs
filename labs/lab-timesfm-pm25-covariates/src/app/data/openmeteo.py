"""The fetch stage: pull two Open-Meteo endpoints into one aligned frame.

Data (c) Open-Meteo, air quality from the CAMS Europe model, weather from
ERA5 reanalysis. Licensed CC-BY-4.0.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

from app import config
from app.errors import FetchError
from app.logging_setup import Logger


def _pull(client: httpx.Client, url: str, variables: tuple[str, ...]) -> pd.DataFrame:
    response = client.get(
        url,
        params={
            "latitude": config.LATITUDE,
            "longitude": config.LONGITUDE,
            "hourly": ",".join(variables),
            "start_date": config.FETCH_START,
            "end_date": config.FETCH_END,
            "timezone": "UTC",
        },
        timeout=120.0,
    )
    response.raise_for_status()
    hourly = response.json().get("hourly")
    if not hourly or "time" not in hourly:
        raise FetchError(f"{url} returned no hourly block")

    frame = pd.DataFrame({name: hourly[name] for name in variables})
    frame.index = pd.to_datetime(hourly["time"])
    frame.index.name = "time"
    return frame


def _join_and_validate(air: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """Aligns the two endpoints' frames and enforces the fetch's own contract."""
    if not air.index.equals(weather.index):
        raise FetchError(
            "air quality and weather time grid mismatch: "
            f"{len(air)} rows ({air.index[0]}..{air.index[-1]}) vs "
            f"{len(weather)} rows ({weather.index[0]}..{weather.index[-1]})"
        )

    snapshot = air.join(weather)[list(config.ALL_VARIABLES)]
    if snapshot.isnull().to_numpy().any():
        missing = snapshot.isnull().sum()
        raise FetchError(f"nulls in fetched data: {missing[missing > 0].to_dict()}")
    return snapshot


def fetch_snapshot(client: httpx.Client | None = None, *, log: Logger) -> pd.DataFrame:
    """Fetches both endpoints and returns one aligned, null-free frame."""
    owned = client is None
    client = client or httpx.Client()
    try:
        log.info(
            "Fetching the snapshot...", start=config.FETCH_START, end=config.FETCH_END
        )
        air = _pull(client, config.AIR_QUALITY_URL, config.AIR_QUALITY_VARIABLES)
        weather = _pull(client, config.WEATHER_URL, config.WEATHER_VARIABLES)
        snapshot = _join_and_validate(air, weather)
    except Exception:
        log.exception(
            "Fetching the snapshot failed.",
            start=config.FETCH_START,
            end=config.FETCH_END,
        )
        raise
    else:
        log.info("Fetching the snapshot succeeded.", rows=len(snapshot))
        return snapshot
    finally:
        if owned:
            client.close()


def write_snapshot(frame: pd.DataFrame, path: Path, *, log: Logger) -> None:
    """Writes the snapshot CSV, creating the parent directory if needed."""
    try:
        log.info("Writing the snapshot...", path=str(path), rows=len(frame))
        path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(path, date_format="%Y-%m-%dT%H:%M:%S")
    except Exception:
        log.exception("Writing the snapshot failed.", path=str(path))
        raise
    else:
        log.info("Writing the snapshot succeeded.", path=str(path), rows=len(frame))
