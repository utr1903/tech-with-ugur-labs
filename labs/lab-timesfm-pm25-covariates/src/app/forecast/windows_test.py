from __future__ import annotations

import numpy as np
import pandas as pd

from app import config
from app.data import snapshot
from app.forecast import windows
from app.logging_setup import Logger


def test_origins_match_the_measured_backtest_geometry() -> None:
    stamps = windows.origin_timestamps()
    assert len(stamps) == config.EXPECTED_ORIGINS
    assert stamps[0] == pd.Timestamp("2025-12-01T00:00")
    assert stamps[-1] == pd.Timestamp("2026-02-28T00:00")
    assert all(stamp.hour == 0 for stamp in stamps)


def test_windows_are_in_range_and_contiguous(log: Logger) -> None:
    frame = snapshot.load_snapshot(log=log)
    built = windows.build_windows(frame)
    assert len(built) == config.EXPECTED_ORIGINS
    for window in built:
        assert window.start >= 0
        assert window.start + config.CONTEXT_HOURS + config.HORIZON_HOURS <= len(frame)
        # The context ends exactly at the origin.
        assert frame.index[window.start + config.CONTEXT_HOURS] == window.origin


def test_blocks_have_the_documented_shapes(log: Logger) -> None:
    frame = snapshot.load_snapshot(log=log)
    window = windows.build_windows(frame)[0]

    context = windows.context_block(frame, window, ["pm2_5", "wind_speed_10m"])
    assert context.shape == (2, config.CONTEXT_HOURS)

    horizon = windows.horizon_block(frame, window, ["wind_speed_10m"])
    assert horizon.shape == (1, config.HORIZON_HOURS)

    target = windows.target_context(frame, window)
    assert target.shape == (config.CONTEXT_HOURS,)
    assert target.ndim == 1


def test_actuals_are_the_measured_truth(log: Logger) -> None:
    frame = snapshot.load_snapshot(log=log)
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    assert truth.shape == (config.EXPECTED_ORIGINS, config.HORIZON_HOURS)
    first = built[0]
    expected = frame["pm2_5"].to_numpy()[
        first.start + config.CONTEXT_HOURS : first.start
        + config.CONTEXT_HOURS
        + config.HORIZON_HOURS
    ]
    np.testing.assert_allclose(truth[0], expected)
