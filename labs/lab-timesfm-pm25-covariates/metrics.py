"""Scoring a forecast against what actually happened."""

from __future__ import annotations

import numpy as np

import labconfig


def mae(pred: np.ndarray, truth: np.ndarray) -> float:
    """Mean absolute error, in ug/m3."""
    return float(np.mean(np.abs(pred - truth)))


def rmse(pred: np.ndarray, truth: np.ndarray) -> float:
    """Root mean squared error, in ug/m3. Punishes big misses harder."""
    return float(np.sqrt(np.mean((pred - truth) ** 2)))


def mase(pred: np.ndarray, truth: np.ndarray, baseline_mae: float) -> float:
    """Error as a fraction of the seasonal-naive error on the same origins.

    Below 1.0 beats "same hour yesterday"; above 1.0 loses to it. The baseline
    scores exactly 1.0 by construction.
    """
    return mae(pred, truth) / baseline_mae


def band_coverage(quantiles: np.ndarray, truth: np.ndarray) -> float:
    """Fraction of actuals falling inside the 0.1-0.9 prediction band.

    A well calibrated 80% band should land near 0.8.
    """
    low = quantiles[..., labconfig.LOW_QUANTILE_INDEX]
    high = quantiles[..., labconfig.HIGH_QUANTILE_INDEX]
    inside = (truth >= low) & (truth <= high)
    return float(np.mean(inside))


def evaluate(
    pred: np.ndarray,
    truth: np.ndarray,
    baseline_mae: float,
    quantiles: np.ndarray | None = None,
) -> dict[str, float]:
    """The full scorecard for one configuration."""
    return {
        "mae": mae(pred, truth),
        "rmse": rmse(pred, truth),
        "mase": mase(pred, truth, baseline_mae),
        "coverage": (
            band_coverage(quantiles, truth)
            if quantiles is not None
            else float("nan")
        ),
    }
