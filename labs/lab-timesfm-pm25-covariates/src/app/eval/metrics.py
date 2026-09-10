"""Scoring a forecast against what actually happened.

Four numbers per configuration, over all 90 origins x 24 horizon hours.
They are reported together because each one hides something the others
show: MAE treats every error alike, RMSE weights the rare disaster, the
relative score says whether any of it beats doing nothing, and coverage
says whether the uncertainty band means anything.

See docs/METHOD.md section 8 for the formulas and their caveats.
"""

from __future__ import annotations

import numpy as np

from app import config
from app.eval.results import Scores
from app.lib.arrays import FloatArray


def mae(pred: FloatArray, truth: FloatArray) -> float:
    """Mean absolute error, in ug/m3."""
    return float(np.mean(np.abs(pred - truth)))


def rmse(pred: FloatArray, truth: FloatArray) -> float:
    """Root mean squared error, in ug/m3. Punishes big misses harder.

    Squaring before averaging means one 40 ug/m3 miss counts for more than
    ten 4 ug/m3 misses, which MAE would score identically. RMSE >= MAE
    always; the size of the gap is a read on how dispersed the errors are.
    """
    return float(np.sqrt(np.mean((pred - truth) ** 2)))


def mase(pred: FloatArray, truth: FloatArray, baseline_mae: float) -> float:
    """Error as a fraction of the seasonal-naive error on the same origins.

    Below 1.0 beats "same hour yesterday"; above 1.0 loses to it. The baseline
    scores exactly 1.0 by construction.

    NOT textbook MASE. Hyndman & Koehler (2006) scale by the in-sample
    one-step naive error; this scales by the seasonal-naive error measured on
    the same evaluation origins, which makes it a relative MAE. The choice is
    deliberate - "against the baseline on this window" is the comparison a
    reader wants here - but the number is not comparable to a MASE quoted
    anywhere else, and the column is labelled with that caveat in mind.
    """
    return mae(pred, truth) / baseline_mae


def band_coverage(quantiles: FloatArray, truth: FloatArray) -> float:
    """Fraction of actuals falling inside the 0.1-0.9 prediction band.

    The band spans quantiles 0.1 to 0.9, so it is nominally 80% and a well
    calibrated model lands near 0.80. Coverage alone cannot tell you the band
    is good: a uselessly wide band scores perfectly on it. Sharpness is not
    measured here, so read coverage as a floor on credibility, not proof.
    """
    low = quantiles[..., config.LOW_QUANTILE_INDEX]
    high = quantiles[..., config.HIGH_QUANTILE_INDEX]
    inside = (truth >= low) & (truth <= high)
    return float(np.mean(inside))


def evaluate(
    pred: FloatArray,
    truth: FloatArray,
    baseline_mae: float,
    quantiles: FloatArray | None = None,
) -> Scores:
    """The full scorecard for one configuration."""
    return Scores(
        mae=mae(pred, truth),
        rmse=rmse(pred, truth),
        mase=mase(pred, truth, baseline_mae),
        coverage=(
            band_coverage(quantiles, truth) if quantiles is not None else float("nan")
        ),
    )
