"""What a configuration produced, as data rather than a dict of strings."""

from __future__ import annotations

from dataclasses import dataclass

from app.lib.arrays import FloatArray


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
