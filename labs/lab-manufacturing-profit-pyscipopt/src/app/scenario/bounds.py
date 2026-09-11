"""Finite model bounds derived only from validated scenario coefficients."""

from __future__ import annotations

import numpy as np

from app.contracts import DerivedBounds, FloatArray, Scenario


def _freeze(values: FloatArray) -> FloatArray:
    result = np.array(values, dtype=np.float64, copy=True)
    result.flags.writeable = False
    return result


def _available_by_year(scenario: Scenario, investment: str) -> FloatArray:
    index = scenario.axes.investments.index(investment)
    affordable = scenario.central_allowance >= scenario.investment_cost[index]
    available = np.zeros(len(scenario.axes.years), dtype=np.float64)
    for year in range(1, len(scenario.axes.years)):
        available[year] = float(np.any(affordable[:year]))
    return available


def production_bounds(scenario: Scenario) -> FloatArray:
    """Return availability-aware total production bounds by factory and year."""
    manufacturing = scenario.axes.teams.index("manufacturing")
    physical = scenario.factory_capacity.copy()
    germany_available = _available_by_year(scenario, "germany_capacity_upgrade")
    china_available = _available_by_year(scenario, "china_factory")
    physical[0] += scenario.germany_capacity_gain * germany_available
    physical[1] *= china_available
    labor = np.empty_like(physical)
    for factory, region_name in enumerate(scenario.axes.factories):
        region = scenario.axes.regions.index(region_name)
        labor[factory] = (
            scenario.manufacturing_productivity[factory]
            * scenario.staff_max[region, manufacturing]
            / np.min(scenario.manufacturing_effort[factory])
        )
    labor[1] *= china_available
    return _freeze(np.minimum(physical, labor))


def _demand_bounds(scenario: Scenario) -> FloatArray:
    sales = scenario.axes.teams.index("sales")
    result = np.empty_like(scenario.demand_base)
    for market, region_name in enumerate(scenario.axes.markets):
        region = scenario.axes.regions.index(region_name)
        for year in range(len(scenario.axes.years)):
            effort_limit = scenario.staff_max[region, sales, year]
            alpha = scenario.sales_alpha[market, year]
            beta = scenario.sales_beta[market, year]
            vertex = np.clip(alpha / (2 * beta), 0, effort_limit)
            sales_gain = alpha * vertex - beta * vertex**2
            result[market, :, year] = (
                scenario.demand_base[market, :, year]
                + sales_gain
                - scenario.price_sensitivity[market, :, year]
                * (
                    scenario.price_min[market, :, year]
                    - scenario.reference_price[market, :, year]
                )
            )
    return _freeze(result)


def _cash_bound(
    scenario: Scenario,
    production: FloatArray,
    demand: FloatArray,
    electricity: FloatArray,
) -> float:
    revenue = float(np.sum(scenario.price_max * demand))
    salary = float(np.sum(scenario.salary * scenario.staff_max))
    fixed = float(
        np.sum(scenario.office_overhead)
        + np.sum(scenario.factory_overhead)
        + np.sum(scenario.investment_cost)
    )
    variable = 0.0
    shipping = 0.0
    energy = 0.0
    for factory in range(len(scenario.axes.factories)):
        material_rate = (
            np.max(scenario.material_requirement[factory])
            * scenario.material_price[factory]
        )
        variable += float(np.sum(material_rate * production[factory]))
        shipping += float(
            np.sum(np.max(scenario.shipping_cost[factory]) * production[factory])
        )
        energy += float(
            np.sum(
                np.max(scenario.tariff.marginal_rates[factory]) * electricity[factory]
            )
        )
    return revenue + salary + fixed + variable + shipping + energy


def derive_bounds(scenario: Scenario) -> DerivedBounds:
    """Derive finite production, demand, energy, and cash bounds."""
    production = production_bounds(scenario)
    demand = _demand_bounds(scenario)
    factory_open = np.ones_like(production)
    factory_open[1] = _available_by_year(scenario, "china_factory")
    electricity = _freeze(
        scenario.factory_baseline_electricity * factory_open
        + np.max(scenario.electricity_per_unit, axis=1)[:, None] * production
    )
    high_product = scenario.axes.products.index("high_performance")
    high_demand = np.sum(demand[:, high_product, :], axis=0)
    high_production = _freeze(np.minimum(np.sum(production, axis=0), high_demand))
    return DerivedBounds(
        production_max=production,
        high_production_max=high_production,
        demand_max=demand,
        electricity_max=electricity,
        cash_abs_max=_cash_bound(scenario, production, demand, electricity),
    )
