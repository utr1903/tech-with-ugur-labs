import numpy as np
import pytest

import labconfig
import experiments
import forecast
import snapshot
import windows


@pytest.fixture(scope="module")
def frame():
    return snapshot.load_snapshot()


def test_univariate_has_no_covariates(frame):
    window = windows.build_windows(frame)[0]
    past_only, past_future = forecast.covariate_blocks(
        frame, window, experiments.by_name("timesfm-univariate")
    )
    assert past_only is None
    assert past_future is None


def test_past_only_covers_the_context_and_stops_there(frame):
    window = windows.build_windows(frame)[0]
    past_only, past_future = forecast.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-only")
    )
    assert past_only.shape == (2, labconfig.CONTEXT_HOURS)
    assert past_future is None


def test_past_future_extends_exactly_one_horizon_past_the_origin(frame):
    window = windows.build_windows(frame)[0]
    _, past_future = forecast.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-future")
    )
    assert past_future.shape == (
        len(labconfig.WEATHER_VARIABLES),
        labconfig.CONTEXT_HOURS + labconfig.HORIZON_HOURS,
    )


def test_covariates_are_standardised(frame):
    window = windows.build_windows(frame)[0]
    _, past_future = forecast.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-future")
    )
    context = past_future[:, : labconfig.CONTEXT_HOURS]
    np.testing.assert_allclose(context.mean(axis=1), 0.0, atol=1e-4)
    np.testing.assert_allclose(context.std(axis=1), 1.0, atol=1e-4)


def test_the_leaky_control_really_does_see_the_future(frame):
    """The whole point of the control - assert the leak is present."""
    window = windows.build_windows(frame)[0]
    _, past_future = forecast.covariate_blocks(
        frame, window, experiments.by_name("leaky-control")
    )
    assert past_future.shape == (
        2,
        labconfig.CONTEXT_HOURS + labconfig.HORIZON_HOURS,
    )
    # The tail is post-origin data, not a repeat of the last context value.
    tail = past_future[:, labconfig.CONTEXT_HOURS :]
    last_context = past_future[:, labconfig.CONTEXT_HOURS - 1 : labconfig.CONTEXT_HOURS]
    assert not np.allclose(tail, last_context)
