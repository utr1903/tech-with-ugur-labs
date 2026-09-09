"""The baseline a forecast has to beat to be worth anything.

"Tomorrow looks like today" is free, needs no model, and is surprisingly hard
to beat on hourly data with a strong daily cycle.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd

import labconfig
from windows import Window


def seasonal_naive(frame: pd.DataFrame, built: Sequence[Window]) -> np.ndarray:
    """Predicts each horizon hour with the same hour one day earlier."""
    series = frame[labconfig.TARGET].to_numpy()
    predictions = []
    for window in built:
        origin = window.start + labconfig.CONTEXT_HOURS
        start = origin - labconfig.SEASONAL_PERIOD_HOURS
        predictions.append(series[start : start + labconfig.HORIZON_HOURS])
    return np.stack(predictions).astype(np.float32)
