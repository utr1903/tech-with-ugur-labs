from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import httpx
import pandas as pd
import pytest

from app import config
from app.data import openmeteo
from app.errors import FetchError
from app.logging_setup import Logger


def _hourly(
    url_variables: Sequence[str], n: int
) -> dict[str, dict[str, list[str] | list[float]]]:
    times: list[str] = (
        pd.date_range("2025-08-01", periods=n, freq="h")
        .strftime("%Y-%m-%dT%H:%M")
        .tolist()
    )
    payload: dict[str, list[str] | list[float]] = {"time": times}
    for name in url_variables:
        payload[name] = [float(i) for i in range(n)]
    return {"hourly": payload}


def _client(n: int = 48) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        variables = request.url.params["hourly"].split(",")
        return httpx.Response(200, json=_hourly(variables, n))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_snapshot_returns_aligned_frame(log: Logger) -> None:
    with _client() as client:
        df = openmeteo.fetch_snapshot(client=client, log=log)

    assert list(df.columns) == list(config.ALL_VARIABLES)
    assert df.index.name == "time"
    assert len(df) == 48
    assert not df.isnull().to_numpy().any()


def test_fetch_snapshot_rejects_mismatched_time_grids(log: Logger) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        variables = request.url.params["hourly"].split(",")
        # Second endpoint returns a shorter grid.
        return httpx.Response(
            200, json=_hourly(variables, 48 if calls["n"] == 1 else 47)
        )

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(FetchError, match="time grid"),
    ):
        openmeteo.fetch_snapshot(client=client, log=log)


def test_write_snapshot_roundtrips(tmp_path: Path, log: Logger) -> None:
    with _client() as client:
        df = openmeteo.fetch_snapshot(client=client, log=log)

    path = tmp_path / "snap.csv"
    openmeteo.write_snapshot(df, path, log=log)

    reloaded = pd.read_csv(path, index_col="time", parse_dates=["time"])
    pd.testing.assert_frame_equal(df, reloaded)
