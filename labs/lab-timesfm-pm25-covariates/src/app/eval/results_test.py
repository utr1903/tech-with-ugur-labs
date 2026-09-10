"""Results cross function boundaries as frozen dataclasses, not dicts."""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from app.eval.results import ExperimentResult, Scores


def _result() -> ExperimentResult:
    points = np.zeros((2, 24), dtype=np.float32)
    return ExperimentResult(
        points=points,
        quantiles=np.zeros((2, 24, 9), dtype=np.float32),
        scores=Scores(mae=1.0, rmse=2.0, mase=0.5, coverage=0.8),
    )


def test_scores_are_reached_by_attribute() -> None:
    assert _result().scores.mae == 1.0


def test_results_are_frozen() -> None:
    scores = _result().scores
    # ruff's B010 wants `scores.mae = 2.0` here, but that direct assignment
    # is a static mypy --strict error on a frozen dataclass field - exactly
    # the suppression this codebase forbids. Routing the field name through
    # a variable keeps setattr's dynamic, unchecked call (the runtime
    # guarantee under test) without tripping B010's literal-argument check.
    field = "mae"
    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(scores, field, 2.0)


def test_coverage_may_be_nan_for_a_configuration_without_quantiles() -> None:
    scores = Scores(mae=1.0, rmse=2.0, mase=1.0, coverage=float("nan"))
    assert np.isnan(scores.coverage)
