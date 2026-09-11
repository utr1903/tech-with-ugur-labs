"""Behavior tests for the bounded three-year PySCIPOpt model."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.logging_setup import Logger
from app.model import build_model
from app.scenario import Scenario, SolverSettings
from app.solver import solve_model

EXACT_SOLVE = SolverSettings(time_limit_seconds=10.0, relative_gap=0.0)


def _simple_capacity_scenario(scenario: Scenario) -> Scenario:
    """Remove research and make forced expansion timing easy to observe."""
    return replace(
        scenario,
        demand_units=np.array([6000.0, 6000.0, 6000.0]),
        max_researchers=0,
        expansion_cost_usd=1.0,
    )


def test_delayed_persistent_research(scenario: Scenario, log: Logger) -> None:
    """Research savings begin next year and remain in every later unit cost."""
    built = build_model(scenario, log=log)
    for year, count in enumerate((2, 1, 0)):
        built.model.addCons(built.variables.researchers[year] == count)

    result = solve_model(built, EXACT_SOLVE, log=log)

    assert result.decisions is not None
    np.testing.assert_allclose(result.decisions.unit_cost, [50, 43, 39], atol=1e-5)


def test_default_plan_has_hand_enumerated_optimum(
    scenario: Scenario, log: Logger
) -> None:
    """The synthetic default reaches the independently enumerated $372,000 cash."""
    result = solve_model(build_model(scenario, log=log), EXACT_SOLVE, log=log)

    assert result.decisions is not None
    assert result.objective_usd == pytest.approx(372000.0, abs=1e-4)


def test_small_no_investment_optimum(scenario: Scenario, log: Logger) -> None:
    """A hand-checkable case buys two workers and produces three units each year."""
    small = replace(
        scenario,
        selling_price_usd_per_unit=10.0,
        initial_unit_cost_usd=2.0,
        minimum_unit_cost_usd=2.0,
        demand_units=np.array([3.0, 3.0, 3.0]),
        units_per_worker_per_year=2.0,
        worker_salary_usd_per_year=3.0,
        max_workers=2,
        capacity_units_per_year=3.0,
        max_researchers=0,
        expansion_cost_usd=100.0,
    )
    result = solve_model(build_model(small, log=log), EXACT_SOLVE, log=log)

    assert result.decisions is not None
    np.testing.assert_allclose(result.decisions.workers, [2, 2, 2], atol=1e-6)
    np.testing.assert_allclose(result.decisions.units_produced, [3, 3, 3], atol=1e-6)
    assert result.objective_usd == pytest.approx(54.0, abs=1e-4)


def test_zero_demand_uses_no_people_or_expansion(
    scenario: Scenario, log: Logger
) -> None:
    """With nothing to sell, every positive-cost staffing decision stays zero."""
    shutdown = replace(scenario, demand_units=np.zeros(3, dtype=np.float64))
    result = solve_model(build_model(shutdown, log=log), EXACT_SOLVE, log=log)

    assert result.decisions is not None
    np.testing.assert_allclose(result.decisions.workers, np.zeros(3), atol=1e-6)
    np.testing.assert_allclose(result.decisions.researchers, np.zeros(3), atol=1e-6)
    np.testing.assert_allclose(result.decisions.expansion_start, np.zeros(3), atol=1e-6)


def test_year_one_expansion_adds_capacity_in_years_two_and_three(
    scenario: Scenario, log: Logger
) -> None:
    """An expansion paid in year one leaves year one at base capacity."""
    built = build_model(_simple_capacity_scenario(scenario), log=log)
    built.model.addCons(built.variables.expansion_start[0] == 1)
    result = solve_model(built, EXACT_SOLVE, log=log)

    assert result.decisions is not None
    np.testing.assert_allclose(
        result.decisions.units_produced, [4000, 6000, 6000], atol=1e-5
    )


def test_year_two_expansion_adds_capacity_only_in_year_three(
    scenario: Scenario, log: Logger
) -> None:
    """An expansion paid in year two cannot raise output until year three."""
    built = build_model(_simple_capacity_scenario(scenario), log=log)
    built.model.addCons(built.variables.expansion_start[1] == 1)
    result = solve_model(built, EXACT_SOLVE, log=log)

    assert result.decisions is not None
    np.testing.assert_allclose(
        result.decisions.units_produced, [4000, 4000, 6000], atol=1e-5
    )


@pytest.mark.parametrize("starts", [(0, 0, 1), (1, 1, 0)])
def test_disallows_year_three_or_multiple_expansion_starts(
    scenario: Scenario, log: Logger, starts: tuple[int, int, int]
) -> None:
    """Expansion may start at most once and never in the final modeled year."""
    built = build_model(_simple_capacity_scenario(scenario), log=log)
    for year, value in enumerate(starts):
        built.model.addCons(built.variables.expansion_start[year] == value)

    result = solve_model(built, EXACT_SOLVE, log=log)

    assert result.decisions is None


def test_cost_floor_makes_excessive_research_infeasible(
    scenario: Scenario, log: Logger
) -> None:
    """The minimum unit cost constrains research instead of clipping its savings."""
    tight_floor = replace(scenario, minimum_unit_cost_usd=45.0)
    built = build_model(tight_floor, log=log)
    built.model.addCons(built.variables.researchers[0] == 2)
    result = solve_model(built, EXACT_SOLVE, log=log)

    assert result.decisions is None


def test_final_year_research_is_zero(scenario: Scenario, log: Logger) -> None:
    """Final-year research has salary cost but no cost-saving year to benefit."""
    result = solve_model(build_model(scenario, log=log), EXACT_SOLVE, log=log)

    assert result.decisions is not None
    assert result.decisions.researchers[2] == pytest.approx(0.0, abs=1e-6)
