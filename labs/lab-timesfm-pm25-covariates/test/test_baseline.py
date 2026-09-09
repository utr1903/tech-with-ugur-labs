import numpy as np
import pytest

import labconfig
import baseline
import metrics
import snapshot
import windows


def test_seasonal_naive_is_yesterday_same_hour():
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    predicted = baseline.seasonal_naive(frame, built)

    assert predicted.shape == (labconfig.EXPECTED_ORIGINS, labconfig.HORIZON_HOURS)

    series = frame["pm2_5"].to_numpy()
    first = built[0]
    origin_position = first.start + labconfig.CONTEXT_HOURS
    expected = series[
        origin_position - labconfig.SEASONAL_PERIOD_HOURS :
        origin_position - labconfig.SEASONAL_PERIOD_HOURS + labconfig.HORIZON_HOURS
    ]
    np.testing.assert_allclose(predicted[0], expected)


def test_seasonal_naive_reproduces_the_reference_mae():
    """17.83 ug/m3 is the number the whole scoreboard is calibrated against."""
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    measured = metrics.mae(baseline.seasonal_naive(frame, built), truth)

    assert measured == pytest.approx(
        labconfig.REFERENCE_SEASONAL_NAIVE_MAE,
        abs=labconfig.REFERENCE_MAE_TOLERANCE,
    )
