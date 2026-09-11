"""Physical-domain checks for products, factories, R&D, and markets."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from app.contracts import FloatArray, Scenario
from app.errors import ScenarioError
from app.scenario.bounds import production_bounds


def _validate_product_requirements(scenario: Scenario) -> None:
    pairs: Iterable[tuple[FloatArray, str]] = (
        (scenario.manufacturing_effort, "scenario.factories.manufacturing_effort"),
        (scenario.material_requirement, "scenario.materials.requirement_per_unit"),
        (scenario.electricity_per_unit, "scenario.electricity.per_unit"),
    )
    for values, path in pairs:
        for factory, name in enumerate(scenario.axes.factories):
            if values[factory, 0] != values[factory, 1]:
                raise ScenarioError(
                    f"{path}.{name}.high_performance: must match standard"
                )


def _validate_tariffs(scenario: Scenario) -> None:
    production = production_bounds(scenario)
    tariff = scenario.tariff
    if tariff.thresholds.ndim != 2 or tariff.marginal_rates.ndim != 2:
        raise ScenarioError(
            "scenario.electricity.tariffs: expected two-dimensional arrays"
        )
    if tariff.thresholds.shape[1] != tariff.marginal_rates.shape[1] + 1:
        raise ScenarioError(
            "scenario.electricity.tariffs: thresholds must have block count plus one"
        )
    for factory, name in enumerate(scenario.axes.factories):
        thresholds = tariff.thresholds[factory]
        rates = tariff.marginal_rates[factory]
        path = f"scenario.electricity.tariffs.{name}"
        if thresholds[0] != 0 or np.any(np.diff(thresholds) <= 0):
            raise ScenarioError(f"{path}.thresholds: must start at zero and increase")
        if np.any(rates < 0) or np.any(np.diff(rates) <= 0):
            raise ScenarioError(
                f"{path}.marginal_rates_musd: must be nonnegative and strictly increase"
            )
        is_open = np.ones(len(scenario.axes.years))
        if name == "china":
            is_open = (production[factory] > 0).astype(np.float64)
        maximum_use = scenario.factory_baseline_electricity[factory] * is_open + (
            np.max(scenario.electricity_per_unit[factory]) * production[factory]
        )
        for year, use in enumerate(maximum_use):
            if thresholds[-1] < use:
                raise ScenarioError(
                    f"{path}.thresholds: does not cover year_{year + 1} maximum energy"
                )


def _validate_research(scenario: Scenario) -> None:
    rd_team = scenario.axes.teams.index("rd")
    for rd_region, name in enumerate(("us", "india")):
        region = scenario.axes.regions.index(name)
        for year in range(len(scenario.axes.years)):
            minimum = int(scenario.staff_min[region, rd_team, year])
            maximum = int(scenario.staff_max[region, rd_team, year])
            for headcount in range(minimum, maximum + 1):
                for upgrade in (0, 1):
                    output = (
                        scenario.rd_alpha[rd_region, year]
                        + scenario.rd_upgrade_alpha_gain[rd_region] * upgrade
                    ) * headcount - scenario.rd_beta[rd_region, year] * headcount**2
                    if output < 0:
                        raise ScenarioError(
                            f"scenario.research.regions.{name}.beta.year_{year + 1}: "
                            f"negative output at headcount {headcount}"
                        )


def _validate_demand(scenario: Scenario) -> None:
    sales_team = scenario.axes.teams.index("sales")
    for market, name in enumerate(scenario.axes.markets):
        staff_region = scenario.axes.regions.index(name)
        for product, product_name in enumerate(scenario.axes.products):
            for year in range(len(scenario.axes.years)):
                if scenario.sales_beta[market, year] <= 0:
                    raise ScenarioError(
                        f"scenario.market.sales_beta.{name}.year_{year + 1}: "
                        "must be positive"
                    )
                effort_max = scenario.staff_max[staff_region, sales_team, year]
                alpha = scenario.sales_alpha[market, year]
                beta = scenario.sales_beta[market, year]
                minimum_sales = min(0.0, alpha * effort_max - beta * effort_max**2)
                minimum_demand = (
                    scenario.demand_base[market, product, year]
                    + minimum_sales
                    - scenario.price_sensitivity[market, product, year]
                    * (
                        scenario.price_max[market, product, year]
                        - scenario.reference_price[market, product, year]
                    )
                )
                if minimum_demand < 0:
                    raise ScenarioError(
                        f"scenario.market.demand_base.{name}.{product_name}."
                        f"year_{year + 1}: permits negative demand"
                    )
        for year in range(len(scenario.axes.years)):
            if (
                scenario.demand_base[market, 1, year]
                <= scenario.demand_base[market, 0, year]
            ):
                raise ScenarioError(
                    f"scenario.market.demand_base.{name}.high_performance."
                    f"year_{year + 1}: must exceed standard at reference conditions"
                )


def validate_physical_domain(scenario: Scenario) -> None:
    """Validate cross-coefficient physical assumptions."""
    _validate_product_requirements(scenario)
    _validate_tariffs(scenario)
    _validate_research(scenario)
    _validate_demand(scenario)
