from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from app import config
from app.data import snapshot
from app.eval import experiments
from app.forecast import model, windows
from app.logging_setup import get_logger


@pytest.fixture(scope="module")
def frame():
    # Module-scoped, so it cannot depend on the function-scoped `log`
    # fixture - build a bound logger directly instead.
    return snapshot.load_snapshot(log=get_logger(app_name="test"))


class FakeForecaster:
    """Records every predict_batch call instead of running the real model.

    `predict_batch` returns a generator in the real library - returning one
    here too keeps run_experiment's `list(...)` wrapping honest.
    """

    def __init__(self):
        self.calls: list[dict] = []

    def predict_batch(self, **kwargs):
        self.calls.append(kwargs)
        n = len(kwargs["contexts"])
        return (
            SimpleNamespace(
                forecast=np.zeros(config.HORIZON_HOURS, dtype=np.float32),
                quantiles=np.zeros(
                    (config.HORIZON_HOURS, config.N_QUANTILES),
                    dtype=np.float32,
                ),
            )
            for _ in range(n)
        )


def test_univariate_has_no_covariates(frame):
    window = windows.build_windows(frame)[0]
    past_only, past_future = model.covariate_blocks(
        frame, window, experiments.by_name("timesfm-univariate")
    )
    assert past_only is None
    assert past_future is None


def test_past_only_covers_the_context_and_stops_there(frame):
    window = windows.build_windows(frame)[0]
    past_only, past_future = model.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-only")
    )
    assert past_only.shape == (2, config.CONTEXT_HOURS)
    assert past_future is None


def test_past_future_extends_exactly_one_horizon_past_the_origin(frame):
    window = windows.build_windows(frame)[0]
    _, past_future = model.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-future")
    )
    assert past_future.shape == (
        len(config.WEATHER_VARIABLES),
        config.CONTEXT_HOURS + config.HORIZON_HOURS,
    )


def test_covariates_are_standardised(frame):
    window = windows.build_windows(frame)[0]
    _, past_future = model.covariate_blocks(
        frame, window, experiments.by_name("timesfm-past-future")
    )
    context = past_future[:, : config.CONTEXT_HOURS]
    np.testing.assert_allclose(context.mean(axis=1), 0.0, atol=1e-4)
    np.testing.assert_allclose(context.std(axis=1), 1.0, atol=1e-4)


def test_the_leaky_control_really_does_see_the_future(frame):
    """The whole point of the control - assert the leak is present.

    Recompute the expected standardised tail independently, straight from the
    frame's genuine measured future values for NO2 and CO, and check the
    covariate block actually carries that - not merely "something other than
    a flat repeat of the last context value".
    """
    window = windows.build_windows(frame)[0]
    experiment = experiments.by_name("leaky-control")
    _, past_future = model.covariate_blocks(frame, window, experiment)
    assert past_future.shape == (
        2,
        config.CONTEXT_HOURS + config.HORIZON_HOURS,
    )

    raw_context = windows.context_block(frame, window, experiment.past_future)
    raw_horizon = windows.horizon_block(frame, window, experiment.past_future)
    mean = raw_context.mean(axis=1, keepdims=True)
    sd = np.maximum(raw_context.std(axis=1, keepdims=True), 1e-6)
    expected_tail = (raw_horizon - mean) / sd

    tail = past_future[:, config.CONTEXT_HOURS :]
    np.testing.assert_allclose(tail, expected_tail, atol=1e-4)

    # And it really is the future, not a repeat of the last context value.
    last_context = past_future[:, config.CONTEXT_HOURS - 1 : config.CONTEXT_HOURS]
    assert not np.allclose(tail, last_context)


def test_run_experiment_issues_one_batched_call_for_every_origin(frame, log):
    """A regression to a 90-iteration Python loop would still pass every
    other test in this file - only checking the call count catches it."""
    built = windows.build_windows(frame)[:3]
    forecaster = FakeForecaster()

    points, quantiles = model.run_experiment(
        forecaster, frame, built, experiments.by_name("timesfm-univariate"), log=log
    )

    assert len(forecaster.calls) == 1
    assert len(forecaster.calls[0]["contexts"]) == 3
    assert points.shape == (3, config.HORIZON_HOURS)
    assert quantiles.shape == (3, config.HORIZON_HOURS, config.N_QUANTILES)


def test_run_experiment_passes_none_for_unused_covariate_kinds(frame, log):
    """Unused covariate kinds must reach predict_batch as None, not as a
    same-length list of Nones - the model branches on identity, not content."""
    built = windows.build_windows(frame)[:2]
    forecaster = FakeForecaster()

    model.run_experiment(
        forecaster, frame, built, experiments.by_name("timesfm-univariate"), log=log
    )

    call = forecaster.calls[0]
    assert call["past_only_covariates"] is None
    assert call["past_future_covariates"] is None


def test_run_experiment_passes_a_covariate_list_for_past_only(frame, log):
    built = windows.build_windows(frame)[:2]
    forecaster = FakeForecaster()

    model.run_experiment(
        forecaster, frame, built, experiments.by_name("timesfm-past-only"), log=log
    )

    call = forecaster.calls[0]
    assert isinstance(call["past_only_covariates"], list)
    assert len(call["past_only_covariates"]) == len(built)
    assert all(isinstance(c, np.ndarray) for c in call["past_only_covariates"])
    assert call["past_future_covariates"] is None


def test_run_experiment_passes_covariate_lists_for_both_kinds(frame, log):
    built = windows.build_windows(frame)[:2]
    forecaster = FakeForecaster()

    model.run_experiment(
        forecaster, frame, built, experiments.by_name("timesfm-both"), log=log
    )

    call = forecaster.calls[0]
    assert isinstance(call["past_only_covariates"], list)
    assert isinstance(call["past_future_covariates"], list)


def test_run_experiment_passes_the_documented_predict_batch_flags(frame, log):
    built = windows.build_windows(frame)[:2]
    forecaster = FakeForecaster()

    model.run_experiment(
        forecaster, frame, built, experiments.by_name("timesfm-past-future"), log=log
    )

    call = forecaster.calls[0]
    assert call["padding_mode"] == "edge"
    assert call["use_symmetric_averaging"] is False
