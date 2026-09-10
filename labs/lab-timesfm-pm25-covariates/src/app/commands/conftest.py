"""The synthetic scoreboard both report tests render from."""

from __future__ import annotations

import numpy as np
import pytest

from app import config
from app.eval.results import ExperimentResult, Scores


@pytest.fixture
def results() -> dict[str, ExperimentResult]:
    shape = (config.EXPECTED_ORIGINS, config.HORIZON_HOURS)
    points = np.full(shape, 50.0, dtype=np.float32)
    spread = np.linspace(-10.0, 10.0, config.N_QUANTILES, dtype=np.float32)
    quantiles = points[..., None] + spread
    names = [
        "seasonal-naive",
        "timesfm-univariate",
        "timesfm-past-only",
        "timesfm-past-future",
        "timesfm-both",
        "leaky-control",
    ]
    maes = [17.83, 15.0, 15.5, 14.5, 14.8, 6.0]
    return {
        name: ExperimentResult(
            points=points,
            quantiles=quantiles,
            scores=Scores(mae=mae, rmse=mae * 1.3, mase=mae / 17.83, coverage=0.8),
        )
        for name, mae in zip(names, maes, strict=True)
    }
