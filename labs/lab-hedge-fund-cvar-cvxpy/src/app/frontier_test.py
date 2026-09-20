"""Behaviour tests for the two-model frontier sweep.

Every test here solves, so the whole file runs on the 600-scenario fixture
and the full sweep is computed once per session and shared.
"""

from __future__ import annotations

import itertools
from dataclasses import replace

import pytest

from app.contracts import FrontierPoint, MarketScenarios, Scenario
from app.frontier import point_relaxation_overlap, sweep_frontier, target_grid
from app.logging_setup import Logger
from app.tailrisk import portfolio_losses, tail_statistics

# The 600-scenario sample reaches about 0.0104 of monthly net return at the
# shipped mandate, and the shipped grid stops at 0.0100 — so none of the
# twenty-five points is infeasible there. Demonstrating the infeasible case
# needs a grid that runs past what the mandate can deliver.
UNREACHABLE_MAX_TARGET = 0.020
UNREACHABLE_POINTS = 6


@pytest.fixture(scope="session")
def small_frontier(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> tuple[FrontierPoint, ...]:
    """Sweep the shipped grid once on the small sample."""
    return sweep_frontier(small_scenario, small_market, log=log)


@pytest.fixture(scope="session")
def feasible_points(
    small_frontier: tuple[FrontierPoint, ...],
) -> tuple[FrontierPoint, ...]:
    """The points whose CVaR solve produced a book."""
    return tuple(
        point for point in small_frontier if point.cvar_outcome.solution is not None
    )


def test_the_frontier_compiles_once_and_solves_many(
    small_scenario: Scenario, small_frontier: tuple[FrontierPoint, ...]
) -> None:
    """Every point comes off one compiled problem via its target parameter.

    The observable consequence is that the sweep returns exactly the
    configured number of points, in ascending target order, each carrying
    the grid value it was solved at. `algorithms_test.py` checks the other
    half of the same claim — that a problem whose shape changes has to be
    rebuilt.
    """
    assert len(small_frontier) == small_scenario.frontier.points
    targets = [point.target_monthly for point in small_frontier]
    assert targets == sorted(targets)
    assert targets == pytest.approx(list(target_grid(small_scenario.frontier)))


def test_cvar_rises_monotonically_with_the_return_target(
    feasible_points: tuple[FrontierPoint, ...],
) -> None:
    """Demanding more return can never cost less tail risk.

    The feasible set shrinks as the target rises, so the optimum of a
    minimization over it can only rise. A sweep that came back with a dip
    would mean one of the points had not converged, and no amount of
    prose about efficient frontiers would make the chart honest.
    """
    values = []
    for point in feasible_points:
        assert point.cvar_outcome.solution is not None
        values.append(point.cvar_outcome.solution.objective)
    assert len(values) > 1
    assert all(later >= earlier - 1e-9 for earlier, later in itertools.pairwise(values))


def test_unreachable_targets_are_recorded_infeasible_with_no_weights(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Past what the mandate can earn, the status is recorded and no book is."""
    stretched = replace(
        small_scenario,
        frontier=replace(
            small_scenario.frontier,
            points=UNREACHABLE_POINTS,
            max_target_monthly=UNREACHABLE_MAX_TARGET,
        ),
    )
    points = sweep_frontier(stretched, small_market, log=log)

    infeasible = [
        point for point in points if point.cvar_outcome.status.startswith("infeasible")
    ]
    assert infeasible
    assert all(point.cvar_outcome.solution is None for point in infeasible)
    assert all(point.cvar_of_variance_portfolio is None for point in infeasible)
    assert all(not point.cvar_outcome.duals for point in infeasible)


def test_the_variance_portfolio_is_scored_on_the_cvar_ruler(
    feasible_points: tuple[FrontierPoint, ...],
    small_market: MarketScenarios,
    small_scenario: Scenario,
) -> None:
    """The mean-variance book is measured with the CVaR model's own yardstick.

    Both books face the identical feasible set and the identical return
    target, so the CVaR model's optimum is the lowest empirical CVaR any
    book can reach at that target. The variance book is therefore never
    below it, and the gap is what minimizing the wrong risk measure costs.
    """
    for point in feasible_points:
        assert point.cvar_outcome.solution is not None
        assert point.variance_outcome.solution is not None
        assert point.cvar_of_variance_portfolio is not None
        recomputed = tail_statistics(
            portfolio_losses(
                small_market.returns, point.variance_outcome.solution.weights
            ),
            small_scenario.cvar_beta,
        ).cvar
        assert point.cvar_of_variance_portfolio == pytest.approx(recomputed)
        assert (
            point.cvar_of_variance_portfolio
            >= point.cvar_outcome.solution.objective - 1e-7
        )


def test_the_split_lapse_is_reported_per_point_rather_than_asserted(
    feasible_points: tuple[FrontierPoint, ...], small_scenario: Scenario
) -> None:
    """The sweep measures where `w = l - s` stops being exact, and says so.

    Borrow fees and half-spreads are charged inside the expected-net-return
    constraint and nowhere else, so they penalise holding a name long and
    short at once only while that constraint is binding. Below the target
    at which it starts to bind, the optimal face widens and an
    interior-point solver settles inside it. Measured at 600 scenarios, 12
    of the 25 targets come back padded, by up to 1.28e-02, and the first
    exact one is 0.00500; at the shipped 10,000 scenarios it is 9 of 25,
    padded by up to 1.37e-02, exact from 0.00375 upward.

    `verify_solution` would refuse those points, and would be right to.
    That is why the sweep reports the overlap instead of asserting on it —
    the lapse is a property of the model worth putting on the chart. The
    hard `relaxation_exact` check stays on the headline portfolio.
    """
    overlaps = [point_relaxation_overlap(point) for point in feasible_points]
    assert all(value is not None for value in overlaps)
    padded = [
        point
        for point, value in zip(feasible_points, overlaps, strict=True)
        if value is not None and value > small_scenario.tolerances.relaxation_abs
    ]
    exact = [
        point
        for point, value in zip(feasible_points, overlaps, strict=True)
        if value is not None and value <= small_scenario.tolerances.relaxation_abs
    ]
    assert padded and exact
    # The lapse is a low-return phenomenon, so every padded point sits
    # below every exact one on the grid.
    assert max(point.target_monthly for point in padded) < min(
        point.target_monthly for point in exact
    )
