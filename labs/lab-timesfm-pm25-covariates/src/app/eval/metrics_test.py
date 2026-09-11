from __future__ import annotations

import numpy as np
import pytest

from app.eval import metrics


def test_mae_and_rmse() -> None:
    truth = np.array([[1.0, 2.0]], dtype=np.float32)
    pred = np.array([[2.0, 4.0]], dtype=np.float32)
    assert metrics.mae(pred, truth) == pytest.approx(1.5)
    assert metrics.rmse(pred, truth) == pytest.approx(np.sqrt(2.5))


def test_mase_is_relative_to_the_baseline() -> None:
    truth = np.array([[1.0, 2.0]], dtype=np.float32)
    pred = np.array([[2.0, 4.0]], dtype=np.float32)
    assert metrics.mase(pred, truth, baseline_mae=3.0) == pytest.approx(0.5)


def test_a_perfect_baseline_scores_mase_of_one() -> None:
    truth = np.array([[1.0, 2.0]], dtype=np.float32)
    pred = np.array([[2.0, 4.0]], dtype=np.float32)
    baseline_mae = metrics.mae(pred, truth)
    assert metrics.mase(pred, truth, baseline_mae) == pytest.approx(1.0)


def test_band_coverage_counts_actuals_inside_the_outer_quantiles() -> None:
    # One origin, two hours, nine quantiles ramping 0..8.
    quantiles = np.tile(np.arange(9.0), (1, 2, 1)).astype(np.float32)
    # inside [0, 8], then far outside
    truth = np.array([[4.0, 100.0]], dtype=np.float32)
    assert metrics.band_coverage(quantiles, truth) == pytest.approx(0.5)


def test_evaluate_reports_nan_coverage_without_quantiles() -> None:
    truth = np.array([[1.0, 2.0]], dtype=np.float32)
    pred = np.array([[1.0, 2.0]], dtype=np.float32)
    scores = metrics.evaluate(pred, truth, baseline_mae=1.0)
    assert scores.mae == pytest.approx(0.0)
    assert np.isnan(scores.coverage)
