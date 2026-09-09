import numpy as np
import pytest

import labconfig
import checks
import snapshot
import windows


def _result(points, quantiles=None, **scores):
    n, h = points.shape
    if quantiles is None:
        spread = np.linspace(-10.0, 10.0, labconfig.N_QUANTILES)
        quantiles = points[..., None] + spread
    base = {"mae": 0.0, "rmse": 0.0, "mase": 0.0, "coverage": 0.8}
    base.update(scores)
    return {"points": points, "quantiles": quantiles, "scores": base}


@pytest.fixture(scope="module")
def fixtures():
    frame = snapshot.load_snapshot()
    built = windows.build_windows(frame)
    truth = windows.actuals(frame, built)
    return frame, built, truth


def _passing_results(truth):
    shape = truth.shape
    return {
        "seasonal-naive": _result(np.full(shape, 50.0), mae=17.83, mase=1.0),
        "timesfm-univariate": _result(np.full(shape, 50.0), mae=15.0, mase=0.84),
        "timesfm-past-only": _result(np.full(shape, 50.0), mae=15.5, mase=0.87),
        "timesfm-past-future": _result(np.full(shape, 50.0), mae=14.5, mase=0.81),
        "timesfm-both": _result(np.full(shape, 50.0), mae=14.8, mase=0.83),
        "leaky-control": _result(np.full(shape, 50.0), mae=6.0, mase=0.34),
    }


def test_all_checks_pass_on_well_formed_results(fixtures):
    frame, built, truth = fixtures
    results = _passing_results(truth)
    repeat = results["timesfm-univariate"]["points"][: labconfig.DETERMINISM_ORIGINS]
    outcomes = checks.run_all(frame, built, truth, results, repeat)

    assert len(outcomes) == 6
    assert all(o.passed for o in outcomes), [o.detail for o in outcomes if not o.passed]


def test_check_fails_when_the_model_loses_to_the_baseline(fixtures):
    frame, built, truth = fixtures
    results = _passing_results(truth)
    results["timesfm-univariate"]["scores"]["mae"] = 19.0
    repeat = results["timesfm-univariate"]["points"][: labconfig.DETERMINISM_ORIGINS]
    outcomes = {o.name: o for o in checks.run_all(frame, built, truth, results, repeat)}
    assert not outcomes["beats-the-baseline"].passed


def test_check_fails_when_leakage_is_invisible(fixtures):
    """If the leaky run does not win, the covariates are not being used."""
    frame, built, truth = fixtures
    results = _passing_results(truth)
    results["leaky-control"]["scores"]["mae"] = 16.0  # worse than past-future's 14.5
    repeat = results["timesfm-univariate"]["points"][: labconfig.DETERMINISM_ORIGINS]
    outcomes = {o.name: o for o in checks.run_all(frame, built, truth, results, repeat)}
    assert not outcomes["leakage-is-visible"].passed


def test_check_fails_on_non_finite_forecasts(fixtures):
    frame, built, truth = fixtures
    results = _passing_results(truth)
    results["timesfm-both"]["points"][0, 0] = np.nan
    repeat = results["timesfm-univariate"]["points"][: labconfig.DETERMINISM_ORIGINS]
    outcomes = {o.name: o for o in checks.run_all(frame, built, truth, results, repeat)}
    assert not outcomes["shapes-and-finiteness"].passed


def test_check_fails_on_a_miscalibrated_band(fixtures):
    frame, built, truth = fixtures
    results = _passing_results(truth)
    results["timesfm-univariate"]["scores"]["coverage"] = 0.20
    repeat = results["timesfm-univariate"]["points"][: labconfig.DETERMINISM_ORIGINS]
    outcomes = {o.name: o for o in checks.run_all(frame, built, truth, results, repeat)}
    assert not outcomes["calibration-sanity"].passed


def test_check_fails_when_two_runs_disagree(fixtures):
    frame, built, truth = fixtures
    results = _passing_results(truth)
    repeat = results["timesfm-univariate"]["points"][
        : labconfig.DETERMINISM_ORIGINS
    ].copy()
    repeat[0, 0] += 0.001
    outcomes = {o.name: o for o in checks.run_all(frame, built, truth, results, repeat)}
    assert not outcomes["determinism"].passed
