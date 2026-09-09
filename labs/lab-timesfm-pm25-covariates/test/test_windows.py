import numpy as np
import pandas as pd

import labconfig
import snapshot
import windows


def test_origins_match_the_measured_backtest_geometry():
    stamps = windows.origin_timestamps()
    assert len(stamps) == labconfig.EXPECTED_ORIGINS
    assert stamps[0] == pd.Timestamp("2025-12-01T00:00")
    assert stamps[-1] == pd.Timestamp("2026-02-28T00:00")
    assert all(stamp.hour == 0 for stamp in stamps)


def test_windows_are_in_range_and_contiguous():
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    assert len(built) == labconfig.EXPECTED_ORIGINS
    for window in built:
        assert window.start >= 0
        assert (
            window.start + labconfig.CONTEXT_HOURS + labconfig.HORIZON_HOURS
            <= len(frame)
        )
        # The context ends exactly at the origin.
        assert frame.index[window.start + labconfig.CONTEXT_HOURS] == window.origin


def test_blocks_have_the_documented_shapes():
    frame = snapshot.load_snapshot()
    window = windows.build_windows(frame)[0]

    context = windows.context_block(frame, window, ["pm2_5", "wind_speed_10m"])
    assert context.shape == (2, labconfig.CONTEXT_HOURS)

    horizon = windows.horizon_block(frame, window, ["wind_speed_10m"])
    assert horizon.shape == (1, labconfig.HORIZON_HOURS)

    target = windows.target_context(frame, window)
    assert target.shape == (labconfig.CONTEXT_HOURS,)
    assert target.ndim == 1


def test_actuals_are_the_measured_truth():
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    assert truth.shape == (labconfig.EXPECTED_ORIGINS, labconfig.HORIZON_HOURS)
    first = built[0]
    expected = frame["pm2_5"].to_numpy()[
        first.start + labconfig.CONTEXT_HOURS :
        first.start + labconfig.CONTEXT_HOURS + labconfig.HORIZON_HOURS
    ]
    np.testing.assert_allclose(truth[0], expected)
