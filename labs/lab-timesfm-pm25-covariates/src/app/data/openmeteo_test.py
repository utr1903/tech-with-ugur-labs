from __future__ import annotations

import httpx
import pandas as pd
import pytest

from app import config
from app.data import openmeteo


def _hourly(url_variables, n):
    times = pd.date_range("2025-08-01", periods=n, freq="h").strftime(
        "%Y-%m-%dT%H:%M"
    ).tolist()
    payload = {"time": times}
    for name in url_variables:
        payload[name] = [float(i) for i in range(n)]
    return {"hourly": payload}


def _client(n=48):
    def handler(request):
        variables = request.url.params["hourly"].split(",")
        return httpx.Response(200, json=_hourly(variables, n))

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_snapshot_returns_aligned_frame(log):
    with _client() as client:
        df = openmeteo.fetch_snapshot(client=client, log=log)

    assert list(df.columns) == list(config.ALL_VARIABLES)
    assert df.index.name == "time"
    assert len(df) == 48
    assert not df.isnull().to_numpy().any()


def test_fetch_snapshot_rejects_mismatched_time_grids(log):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        variables = request.url.params["hourly"].split(",")
        # Second endpoint returns a shorter grid.
        return httpx.Response(
            200, json=_hourly(variables, 48 if calls["n"] == 1 else 47)
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(openmeteo.FetchError, match="time grid"):
            openmeteo.fetch_snapshot(client=client, log=log)


def test_write_snapshot_roundtrips(tmp_path, log):
    with _client() as client:
        df = openmeteo.fetch_snapshot(client=client, log=log)

    path = tmp_path / "snap.csv"
    openmeteo.write_snapshot(df, path, log=log)

    reloaded = pd.read_csv(path, index_col="time", parse_dates=["time"])
    pd.testing.assert_frame_equal(df, reloaded)
