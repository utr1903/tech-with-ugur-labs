"""What a configuration produced, as data rather than a dict of strings."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

# The forecast arrays are float32 end to end: windows.context_block and
# horizon_block both finish with astype/ascontiguousarray(dtype=np.float32),
# and everything downstream inherits it.
type FloatArray = npt.NDArray[np.float32]


@dataclass(frozen=True)
class Scores:
    """One configuration's scorecard. `coverage` is nan without quantiles."""

    mae: float
    rmse: float
    mase: float
    coverage: float


@dataclass(frozen=True)
class ExperimentResult:
    """One row of the scoreboard, with the forecasts behind it."""

    points: FloatArray
    quantiles: FloatArray
    scores: Scores
