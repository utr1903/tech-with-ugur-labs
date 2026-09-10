"""The baseline a forecast has to beat to be worth anything.

"Same hour yesterday" is free, needs no model, and is surprisingly hard to
beat on hourly data: PM2.5 has a strong 24-hour cycle driven by traffic and
heating, so lagging the series by one day already reproduces most of its
shape. On this window it scores MAE 17.83 ug/m3.

That is why beating it is the one performance assertion the lab enforces. A
zero-shot foundation model that cannot beat a one-line lag has no story, and
a scoreboard without a baseline is a column of numbers with no scale.

See docs/METHOD.md section 9.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd

from app import config
from app.forecast.windows import Window
from app.lib.arrays import FloatArray


def seasonal_naive(frame: pd.DataFrame, built: Sequence[Window]) -> FloatArray:
    """Predicts each horizon hour with the same hour one day earlier."""
    series = frame[config.TARGET].to_numpy()
    predictions = []
    for window in built:
        origin = window.start + config.CONTEXT_HOURS
        start = origin - config.SEASONAL_PERIOD_HOURS
        predictions.append(series[start : start + config.HORIZON_HOURS])
    naive: FloatArray = np.stack(predictions).astype(np.float32)
    return naive
