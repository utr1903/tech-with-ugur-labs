"""The fetch stage: pull two Open-Meteo endpoints into one aligned frame.

Data (c) Open-Meteo, air quality from the CAMS Europe model, weather from
ERA5 reanalysis. Licensed CC-BY-4.0.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

import labconfig


class FetchError(RuntimeError):
    """Raised when the upstream endpoints disagree or return nothing usable."""


def _pull(client: httpx.Client, url: str, variables: tuple[str, ...]) -> pd.DataFrame:
    response = client.get(
        url,
        params={
            "latitude": labconfig.LATITUDE,
            "longitude": labconfig.LONGITUDE,
            "hourly": ",".join(variables),
            "start_date": labconfig.FETCH_START,
            "end_date": labconfig.FETCH_END,
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


def fetch_snapshot(client: httpx.Client | None = None) -> pd.DataFrame:
    """Fetches both endpoints and returns one aligned, null-free frame."""
    owned = client is None
    client = client or httpx.Client()
    try:
        air = _pull(client, labconfig.AIR_QUALITY_URL, labconfig.AIR_QUALITY_VARIABLES)
        weather = _pull(client, labconfig.WEATHER_URL, labconfig.WEATHER_VARIABLES)
    finally:
        if owned:
            client.close()

    if not air.index.equals(weather.index):
        raise FetchError(
            "air quality and weather time grid mismatch: "
            f"{len(air)} rows ({air.index[0]}..{air.index[-1]}) vs "
            f"{len(weather)} rows ({weather.index[0]}..{weather.index[-1]})"
        )

    snapshot = air.join(weather)[list(labconfig.ALL_VARIABLES)]
    if snapshot.isnull().to_numpy().any():
        missing = snapshot.isnull().sum()
        raise FetchError(f"nulls in fetched data: {missing[missing > 0].to_dict()}")
    return snapshot


def write_snapshot(frame: pd.DataFrame, path: Path) -> None:
    """Writes the snapshot CSV, creating the parent directory if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, date_format="%Y-%m-%dT%H:%M:%S")
