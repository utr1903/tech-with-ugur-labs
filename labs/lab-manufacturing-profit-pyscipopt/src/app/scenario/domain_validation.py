"""Sign and range checks required by bound and model formulas."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
import numpy.typing as npt

from app.contracts import FloatArray, Scenario
from app.errors import ScenarioError

type Axes = tuple[tuple[str, ...], ...]
type Rule = tuple[FloatArray, str, Axes]


def _first(condition: npt.NDArray[np.bool_]) -> tuple[int, ...] | None:
    matches = np.argwhere(condition)
    return tuple(int(value) for value in matches[0]) if matches.size else None


def _path(prefix: str, axes: Axes, index: tuple[int, ...]) -> str:
    coordinates = ".".join(
        axes[depth][position] for depth, position in enumerate(index)
    )
    return f"{prefix}.{coordinates}"


def _require_rules(rules: Iterable[Rule], *, positive: bool) -> None:
    for values, prefix, axes in rules:
        index = _first(values <= 0 if positive else values < 0)
        if index is not None:
            domain = "positive" if positive else "nonnegative"
            raise ScenarioError(f"{_path(prefix, axes, index)}: must be {domain}")


def _validate_research(scenario: Scenario, years: tuple[str, ...]) -> None:
    regions = ("us", "india")
    for values, field in ((scenario.rd_alpha, "alpha"), (scenario.rd_beta, "beta")):
        index = _first(values <= 0)
        if index is not None:
            region, year = index
            raise ScenarioError(
                f"scenario.research.regions.{regions[region]}.{field}."
                f"{years[year]}: must be positive"
            )
    gain = _first(scenario.rd_upgrade_alpha_gain < 0)
    if gain is not None:
        raise ScenarioError(
            f"scenario.research.regions.{regions[gain[0]]}.upgrade_alpha_gain: "
            "must be nonnegative"
        )


def _validate_investments(scenario: Scenario) -> None:
    index = _first(scenario.investment_cost < 0)
    if index is not None:
        raise ScenarioError(
            f"scenario.investments.{scenario.axes.investments[index[0]]}.cost_musd: "
            "must be nonnegative"
        )


def validate_coefficient_domains(scenario: Scenario) -> None:
    """Validate every numeric coefficient against its physical domain."""
    axes = scenario.axes
    years = tuple(f"year_{year}" for year in axes.years)
    regions_years = (axes.regions, years)
    factories_years = (axes.factories, years)
    factories_products = (axes.factories, axes.products)
    markets_products_years = (axes.markets, axes.products, years)
    _require_rules(
        (
            (
                scenario.regional_budget,
                "scenario.regional_budget_musd",
                regions_years,
            ),
            (
                scenario.factory_capacity,
                "scenario.factories.capacity",
                factories_years,
            ),
            (
                scenario.manufacturing_productivity,
                "scenario.factories.manufacturing_productivity",
                factories_years,
            ),
            (
                scenario.manufacturing_effort,
                "scenario.factories.manufacturing_effort",
                factories_products,
            ),
            (
                scenario.material_requirement,
                "scenario.materials.requirement_per_unit",
                factories_products,
            ),
            (
                scenario.reference_price,
                "scenario.market.reference_price_musd_per_unit",
                markets_products_years,
            ),
            (
                scenario.price_min,
                "scenario.market.price_min_musd_per_unit",
                markets_products_years,
            ),
            (
                scenario.price_max,
                "scenario.market.price_max_musd_per_unit",
                markets_products_years,
            ),
            (scenario.sales_beta, "scenario.market.sales_beta", (axes.markets, years)),
        ),
        positive=True,
    )
    _require_rules(
        (
            (
                scenario.support_fixed,
                "scenario.support.fixed_headcount",
                regions_years,
            ),
            (
                scenario.support_ratios,
                "scenario.support.coverage_ratios",
                (axes.regions, ("rd", "manufacturing", "sales"), years),
            ),
            (
                scenario.office_overhead,
                "scenario.office_overhead_musd",
                regions_years,
            ),
            (scenario.central_allowance, "scenario.central_allowance_musd", (years,)),
            (
                scenario.process_conversion,
                "scenario.knowledge.process_conversion",
                (years,),
            ),
            (
                scenario.maintenance_required,
                "scenario.knowledge.maintenance_required",
                (years,),
            ),
            (
                scenario.germany_capacity_gain,
                "scenario.factories.germany_capacity_gain",
                (years,),
            ),
            (
                scenario.material_price,
                "scenario.materials.price_musd_per_material",
                factories_years,
            ),
            (
                scenario.factory_baseline_electricity,
                "scenario.electricity.baseline",
                factories_years,
            ),
            (
                scenario.electricity_per_unit,
                "scenario.electricity.per_unit",
                factories_products,
            ),
            (
                scenario.factory_overhead,
                "scenario.factories.overhead_musd",
                factories_years,
            ),
            (
                scenario.shipping_cost,
                "scenario.shipping_cost_musd_per_unit",
                (axes.factories, axes.markets, axes.products),
            ),
            (
                scenario.demand_base,
                "scenario.market.demand_base",
                markets_products_years,
            ),
            (
                scenario.price_sensitivity,
                "scenario.market.price_sensitivity",
                markets_products_years,
            ),
            (
                scenario.sales_alpha,
                "scenario.market.sales_alpha",
                (axes.markets, years),
            ),
        ),
        positive=False,
    )
    _validate_research(scenario, years)
    _validate_investments(scenario)
