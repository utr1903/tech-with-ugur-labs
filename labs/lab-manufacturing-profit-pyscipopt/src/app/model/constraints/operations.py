"""Factory capacity, demand, and revenue-free physical flow conservation."""

from __future__ import annotations

from pyscipopt import Model

from app.contracts import Scenario
from app.model.constraints.investments import availability, factory_open
from app.model.variables import ModelVariables


def add_factory_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Annual pump output <= physical capacity and effort <= staff productivity."""
    model.addMatrixCons(
        v.production[0].sum(axis=0)
        <= s.factory_capacity[0] + s.germany_capacity_gain * availability(v)[2],
        name="germany_capacity",
    )
    model.addMatrixCons(
        v.production[1].sum(axis=0) <= s.factory_capacity[1] * factory_open(v)[1],
        name="china_capacity",
    )
    model.addMatrixCons(
        (s.manufacturing_effort[:, :, None] * v.production).sum(axis=1)
        <= s.manufacturing_productivity * v.headcount[2:, 1],
        name="labor_capacity",
    )


def add_market_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Sales <= base + alpha*e - beta*e² - sensitivity*(price-reference)."""
    effort = s.staff_max[:, 2, None, :] * v.sales_share
    model.addMatrixCons(v.sales_share.sum(axis=1) <= 1, name="share_total")
    model.addMatrixCons(effort.sum(axis=1) <= v.headcount[:, 2], name="sales_effort")
    demand = (
        s.demand_base
        + s.sales_alpha[:, None, :] * effort
        - s.sales_beta[:, None, :] * effort**2
        - s.price_sensitivity * (v.price - s.reference_price)
    )
    model.addMatrixCons(v.sales <= demand, name="market_demand")


def add_flow_constraints(model: Model, v: ModelVariables) -> None:
    """Annual pumps: production[f,p,t]=sum_m x; sales[m,p,t]=sum_f x."""
    model.addMatrixCons(v.production == v.shipment.sum(axis=1), name="production_flow")
    model.addMatrixCons(v.sales == v.shipment.sum(axis=0), name="sales_flow")


def add_electricity_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """Energy = open*baseline + per-unit use; MUSD bill >= every tariff line."""
    model.addMatrixCons(
        v.electricity_use
        == s.factory_baseline_electricity * factory_open(v)
        + (s.electricity_per_unit[:, :, None] * v.production).sum(axis=1),
        name="electricity_use",
    )
    for factory in range(2):
        cumulative_cost = 0.0
        for block, rate in enumerate(s.tariff.marginal_rates[factory]):
            lower, upper = s.tariff.thresholds[factory, block : block + 2]
            model.addMatrixCons(
                v.electricity_cost[factory]
                >= cumulative_cost + rate * (v.electricity_use[factory] - lower),
                name=f"tariff_{factory}_{block}",
            )
            cumulative_cost += float(rate * (upper - lower))
