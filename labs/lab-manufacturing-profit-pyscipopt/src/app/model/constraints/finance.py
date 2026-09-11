"""Annual regional operating limits and cumulative cash in millions of USD."""

from __future__ import annotations

from typing import cast

from pyscipopt import MatrixExpr, Model

from app.contracts import Scenario
from app.model.constraints.investments import factory_open
from app.model.variables import ModelVariables


def operating_cost(v: ModelVariables, s: Scenario) -> MatrixExpr:
    """Regional MUSD = salaries + office + local factory costs + outbound freight."""
    regional = (s.salary * v.headcount).sum(axis=1) + s.office_overhead
    material_units = (s.material_requirement[:, :, None] * v.production).sum(axis=1)
    material = s.material_price * material_units * (1 - v.process_saving[None, :])
    freight = (s.shipping_cost[:, :, :, None] * v.shipment).sum(axis=(1, 2))
    regional[2:] += (
        material + v.electricity_cost + s.factory_overhead * factory_open(v) + freight
    )
    return cast(MatrixExpr, regional)


def add_budget_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Operating cost[r,t] <= regional_budget[r,t], MUSD without carryover."""
    model.addMatrixCons(
        operating_cost(v, s) <= s.regional_budget, name="regional_budget"
    )


def add_cash_objective(model: Model, v: ModelVariables, s: Scenario) -> None:
    """cash_aux <= sum(price*sales - operations - start-year capex), MUSD."""
    revenue = (v.price * v.sales).sum()
    capex = (s.investment_cost[:, None] * v.investment_start).sum()
    model.addCons(
        v.cash_auxiliary <= revenue - operating_cost(v, s).sum() - capex,
        name="cumulative_cash",
    )
    model.setObjective(v.cash_auxiliary, "maximize")
