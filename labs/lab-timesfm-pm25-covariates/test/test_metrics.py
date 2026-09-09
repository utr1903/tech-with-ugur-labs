import numpy as np
import pytest

import metrics


def test_mae_and_rmse():
    truth = np.array([[1.0, 2.0]])
    pred = np.array([[2.0, 4.0]])
    assert metrics.mae(pred, truth) == pytest.approx(1.5)
    assert metrics.rmse(pred, truth) == pytest.approx(np.sqrt(2.5))


def test_mase_is_relative_to_the_baseline():
    truth = np.array([[1.0, 2.0]])
    pred = np.array([[2.0, 4.0]])
    assert metrics.mase(pred, truth, baseline_mae=3.0) == pytest.approx(0.5)


def test_a_perfect_baseline_scores_mase_of_one():
    truth = np.array([[1.0, 2.0]])
    pred = np.array([[2.0, 4.0]])
    baseline_mae = metrics.mae(pred, truth)
    assert metrics.mase(pred, truth, baseline_mae) == pytest.approx(1.0)


def test_band_coverage_counts_actuals_inside_the_outer_quantiles():
    # One origin, two hours, nine quantiles ramping 0..8.
    quantiles = np.tile(np.arange(9.0), (1, 2, 1))
    truth = np.array([[4.0, 100.0]])  # inside [0, 8], then far outside
    assert metrics.band_coverage(quantiles, truth) == pytest.approx(0.5)


def test_evaluate_reports_nan_coverage_without_quantiles():
    truth = np.array([[1.0, 2.0]])
    pred = np.array([[1.0, 2.0]])
    scores = metrics.evaluate(pred, truth, baseline_mae=1.0)
    assert scores["mae"] == pytest.approx(0.0)
    assert np.isnan(scores["coverage"])
