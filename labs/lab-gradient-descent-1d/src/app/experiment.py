"""Polynomial and recorded one-dimensional gradient descent."""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.errors import ExperimentError
from app.logging_setup import Logger


@dataclass(frozen=True)
class Iteration:
    """One recorded optimizer state, before or after an update."""

    run: str
    iteration: int
    x: float
    cost: float
    slope: float


def cost(x: float) -> float:
    """Evaluate the tilted double-well polynomial at a finite point."""
    if not math.isfinite(x):
        raise ExperimentError(f"x must be finite, got {x}")
    value = x * x * (x * x - 4) * (x * x - 4) / 16 + x / 10
    if not math.isfinite(value):
        raise ExperimentError(f"cost is non-finite at x={x}")
    return value


def derivative(x: float) -> float:
    """Evaluate the analytical derivative at a finite point."""
    if not math.isfinite(x):
        raise ExperimentError(f"x must be finite, got {x}")
    value = x * (x * x - 4) * (3 * x * x - 4) / 8 + 0.1
    if not math.isfinite(value):
        raise ExperimentError(f"derivative is non-finite at x={x}")
    return value


def _record_state(run: str, iteration: int, x: float) -> Iteration:
    if not math.isfinite(x):
        raise ExperimentError(f"x is non-finite at iteration {iteration}")
    row = Iteration(
        run=run, iteration=iteration, x=x, cost=cost(x), slope=derivative(x)
    )
    if not all(math.isfinite(value) for value in (row.x, row.cost, row.slope)):
        raise ExperimentError(f"state is non-finite at iteration {iteration}")
    return row


def gradient_descent(
    start: float, learning_rate: float, steps: int, *, run: str, log: Logger
) -> tuple[Iteration, ...]:
    """Record the initial state and every gradient descent update."""
    if not math.isfinite(start):
        raise ExperimentError(f"start must be finite, got {start}")
    if not math.isfinite(learning_rate) or learning_rate <= 0:
        raise ExperimentError(
            f"learning_rate must be finite and positive, got {learning_rate}"
        )
    if isinstance(steps, bool) or not isinstance(steps, int) or steps < 0:
        raise ExperimentError(f"steps must be a non-negative integer, got {steps}")
    if not run:
        raise ExperimentError("run must be non-empty")

    log.info(
        "Running gradient descent...",
        start=start,
        learning_rate=learning_rate,
        steps=steps,
        run=run,
    )
    try:
        rows = []
        x = start
        for iteration in range(steps + 1):
            row = _record_state(run, iteration, x)
            rows.append(row)
            if iteration < steps:
                x -= learning_rate * row.slope
        result = tuple(rows)
    except Exception:
        log.exception(
            "Running gradient descent failed.",
            start=start,
            learning_rate=learning_rate,
            steps=steps,
            run=run,
        )
        raise
    else:
        log.info("Running gradient descent succeeded.", run=run, rows=len(result))
        return result
