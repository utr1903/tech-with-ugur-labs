"""Behavioral checks for the polynomial and gradient descent paths."""

from __future__ import annotations

import importlib
import math
from dataclasses import FrozenInstanceError

import pytest


@pytest.mark.parametrize(
    ("x", "expected"),
    [(-2.0, -0.2), (-1.0, 0.4625), (0.0, 0.0), (1.0, 0.6625), (2.0, 0.2)],
)
def test_cost_matches_hand_calculated_values(x: float, expected: float) -> None:
    experiment = importlib.import_module("app.experiment")
    assert experiment.cost(x) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("x", "expected"),
    [(-2.0, 0.1), (-1.0, -0.275), (0.0, 0.1), (1.0, 0.475), (2.0, 0.1)],
)
def test_derivative_matches_hand_calculated_values(x: float, expected: float) -> None:
    experiment = importlib.import_module("app.experiment")
    assert experiment.derivative(x) == pytest.approx(expected)


@pytest.mark.parametrize("x", [-2.6, -1.0, 0.0, 0.5, 1.0, 2.6])
def test_derivative_agrees_with_central_difference(x: float) -> None:
    experiment = importlib.import_module("app.experiment")
    delta = 1e-5
    numerical = (experiment.cost(x + delta) - experiment.cost(x - delta)) / (2 * delta)
    assert experiment.derivative(x) == pytest.approx(numerical, abs=1e-8)


@pytest.mark.parametrize("start", [-2.6, 0.5, 2.6])
def test_gradient_descent_records_every_state_and_update(start: float) -> None:
    experiment = importlib.import_module("app.experiment")
    logging_setup = importlib.import_module("app.logging_setup")
    rows = experiment.gradient_descent(
        start, 0.04, 100, run="example", log=logging_setup.get_logger()
    )

    assert isinstance(rows, tuple)
    assert len(rows) == 101
    assert [row.iteration for row in rows] == list(range(101))
    assert all(row.run == "example" for row in rows)
    assert rows[0].x == start
    for current, following in zip(rows, rows[1:], strict=False):
        assert following.x == pytest.approx(current.x - 0.04 * current.slope)
        assert following.cost <= current.cost + 1e-15
    assert rows[-1].cost < rows[0].cost
    for row in rows:
        assert row.cost == pytest.approx(experiment.cost(row.x))
        assert row.slope == pytest.approx(experiment.derivative(row.x))
        assert all(math.isfinite(value) for value in (row.x, row.cost, row.slope))

    with pytest.raises(FrozenInstanceError):
        rows[0].x = 0.0


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan, 1e100])
def test_polynomial_rejects_nonfinite_input_or_result(value: float) -> None:
    experiment = importlib.import_module("app.experiment")
    errors = importlib.import_module("app.errors")
    with pytest.raises(errors.ExperimentError):
        experiment.cost(value)
    with pytest.raises(errors.ExperimentError):
        experiment.derivative(value)


@pytest.mark.parametrize("value", ["0.5", None, 1j])
def test_polynomial_rejects_wrong_type_numeric_input(value: object) -> None:
    experiment = importlib.import_module("app.experiment")
    errors = importlib.import_module("app.errors")
    with pytest.raises(errors.ExperimentError):
        experiment.cost(value)
    with pytest.raises(errors.ExperimentError):
        experiment.derivative(value)


@pytest.mark.parametrize(
    ("start", "rate"),
    [("0.5", 0.04), (None, 0.04), (0.5, "0.04"), (0.5, None)],
)
def test_gradient_descent_rejects_wrong_type_numeric_input(
    start: object, rate: object
) -> None:
    experiment = importlib.import_module("app.experiment")
    errors = importlib.import_module("app.errors")
    logging_setup = importlib.import_module("app.logging_setup")
    with pytest.raises(errors.ExperimentError):
        experiment.gradient_descent(
            start, rate, 1, run="example", log=logging_setup.get_logger()
        )


@pytest.mark.parametrize(
    ("start", "rate", "steps", "run"),
    [
        (math.nan, 0.04, 100, "example"),
        (0.5, math.inf, 100, "example"),
        (0.5, 0.0, 100, "example"),
        (0.5, -0.04, 100, "example"),
        (0.5, 0.04, 0, "example"),
        (0.5, 0.04, -1, "example"),
        (0.5, 0.04, 1.5, "example"),
        (0.5, 0.04, 100, ""),
        (1e100, 0.04, 100, "example"),
    ],
)
def test_gradient_descent_rejects_invalid_parameters(
    start: float, rate: float, steps: int, run: str
) -> None:
    experiment = importlib.import_module("app.experiment")
    errors = importlib.import_module("app.errors")
    logging_setup = importlib.import_module("app.logging_setup")
    with pytest.raises(errors.ExperimentError):
        experiment.gradient_descent(
            start, rate, steps, run=run, log=logging_setup.get_logger()
        )
