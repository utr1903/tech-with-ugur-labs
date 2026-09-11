"""Real solves distinguish delayed benefits and physical prerequisites."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.contracts import Scenario
from app.logging_setup import Logger
from app.model import BuiltModel, build_model, solve_model
from app.scenario import derive_bounds


def test_china_start_has_one_year_delay(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    built.model.addMatrixCons(built.variables.investment_start[3] == [1, 0, 0])
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.production[1, :, 0].sum() == pytest.approx(0, abs=1e-7)
    assert result.decisions.headcount[3, 1, 0] == pytest.approx(0, abs=1e-7)
    assert np.all(result.decisions.production[1, :, 1:].sum(axis=0) > 0)
    assert np.all(result.decisions.headcount[3, 1, 1:] >= 1 - 1e-7)
    assert np.all(result.decisions.headcount[3, 2:, :] >= 1 - 1e-7)


def test_germany_upgrade_has_delayed_persistent_capacity(
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    scenario = replace(tiny_scenario, manufacturing_productivity=np.full((2, 3), 8.0))
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addMatrixCons(built.variables.investment_start[2] == [1, 0, 0])
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.production[0].sum(axis=0) == pytest.approx([8, 12, 12])


@pytest.mark.parametrize("starts", [(1, 1, 0), (0, 0, 1)])
def test_investment_cannot_repeat_or_start_in_final_year(
    built: BuiltModel,
    tiny_scenario: Scenario,
    log: Logger,
    starts: tuple[int, int, int],
) -> None:
    built.model.addMatrixCons(built.variables.investment_start[0] == starts)
    result = solve_model(built, tiny_scenario, log=log)
    assert result.metadata.status == "infeasible"
    assert result.decisions is None


def test_central_allowances_have_no_carryover(
    tiny_scenario: Scenario, log: Logger
) -> None:
    scenario = replace(tiny_scenario, central_allowance=np.array([4.0, 0.0, 4.0]))
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addCons(built.variables.investment_start[0, 1] == 1)
    assert solve_model(built, scenario, log=log).decisions is None


def test_staffing_floor_is_enforced(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    built.model.addCons(built.variables.headcount[0, 0, 0] == 0)
    assert solve_model(built, tiny_scenario, log=log).decisions is None


def test_support_covers_teams(tiny_scenario: Scenario, log: Logger) -> None:
    scenario = replace(tiny_scenario, support_ratios=np.ones((4, 3, 3)))
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addCons(built.variables.headcount[0, 3, 0] == 2)
    assert solve_model(built, scenario, log=log).decisions is None


def test_sales_share_cannot_double_count_team(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    built.model.addMatrixCons(built.variables.sales_share[0, :, 0] == 0.75)
    assert solve_model(built, tiny_scenario, log=log).decisions is None


def test_sales_effort_cannot_exceed_actual_headcount(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    built.model.addCons(built.variables.headcount[0, 2, 0] == 1)
    built.model.addCons(built.variables.sales_share[0, 0, 0] == 0.75)
    assert solve_model(built, tiny_scenario, log=log).decisions is None


def test_flow_conserves_production_and_sales(
    built: BuiltModel, tiny_scenario: Scenario, log: Logger
) -> None:
    result = solve_model(built, tiny_scenario, log=log)
    assert result.decisions is not None
    values = result.decisions
    assert values.shipment.sum(axis=1) == pytest.approx(values.production, abs=1e-7)
    assert values.shipment.sum(axis=0) == pytest.approx(values.sales, abs=1e-7)


@pytest.mark.parametrize(
    ("energy", "bill"),
    [(0, 0), (1, 0.1), (2, 0.2), (3, 0.4), (4, 0.6), (6, 1.2), (20, 5.4)],
)
def test_electricity_uses_marginal_blocks(
    tiny_scenario: Scenario,
    log: Logger,
    energy: float,
    bill: float,
) -> None:
    scenario = replace(
        tiny_scenario, factory_baseline_electricity=np.array([[energy] * 3, [0] * 3])
    )
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addMatrixCons(built.variables.production == 0)
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    assert result.decisions.electricity_cost[0] == pytest.approx([bill] * 3, abs=1e-7)


def test_regional_budget_is_annual(tiny_scenario: Scenario, log: Logger) -> None:
    budget = tiny_scenario.regional_budget.copy()
    budget[0, 1] = 0.2  # US needs three people at 0.1 each.
    scenario = replace(tiny_scenario, regional_budget=budget)
    built = build_model(scenario, derive_bounds(scenario), log=log)
    assert solve_model(built, scenario, log=log).decisions is None


def test_demand_uses_price_and_headcount_equivalent_effort(
    tiny_scenario: Scenario,
    log: Logger,
) -> None:
    scenario = replace(
        tiny_scenario,
        demand_base=tiny_scenario.demand_base - 8,
        price_min=np.full((4, 2, 3), 3.0),
        price_max=np.full((4, 2, 3), 3.0),
    )
    built = build_model(scenario, derive_bounds(scenario), log=log)
    built.model.addMatrixCons(built.variables.sales_share[0, 0] == 0.5)
    built.model.addMatrixCons(built.variables.headcount[0, 2] == 1)
    built.model.addMatrixCons(built.variables.investment_start == 0)
    built.model.addMatrixCons(built.variables.product_active == 0)
    built.model.addMatrixCons(built.variables.sales[1:] == 0)
    result = solve_model(built, scenario, log=log)
    assert result.decisions is not None
    # e=max_staff*share=2*.5=1. Demand=2+1-.1*1²-(3-2)=1.9.
    assert result.decisions.sales[0, 0] == pytest.approx([1.9] * 3, abs=1e-6)
