"""Conversion of price, demand, and sales-response coefficients."""

from __future__ import annotations

from dataclasses import dataclass

from app.contracts import Axes, FloatArray
from app.scenario.parsing import tensor
from app.scenario.sections import ScenarioSections


@dataclass(frozen=True)
class MarketData:
    """Immutable market coefficients."""

    demand_base: FloatArray
    reference_price: FloatArray
    price_min: FloatArray
    price_max: FloatArray
    price_sensitivity: FloatArray
    sales_alpha: FloatArray
    sales_beta: FloatArray


def convert_market(sections: ScenarioSections, axes: Axes) -> MarketData:
    """Convert market mappings in canonical axis order."""
    years = tuple(f"year_{year}" for year in axes.years)
    cube = (axes.markets, axes.products, years)
    market = sections.market
    return MarketData(
        demand_base=tensor(market["demand_base"], "scenario.market.demand_base", cube),
        reference_price=tensor(
            market["reference_price_musd_per_unit"],
            "scenario.market.reference_price_musd_per_unit",
            cube,
        ),
        price_min=tensor(
            market["price_min_musd_per_unit"],
            "scenario.market.price_min_musd_per_unit",
            cube,
        ),
        price_max=tensor(
            market["price_max_musd_per_unit"],
            "scenario.market.price_max_musd_per_unit",
            cube,
        ),
        price_sensitivity=tensor(
            market["price_sensitivity"],
            "scenario.market.price_sensitivity",
            cube,
        ),
        sales_alpha=tensor(
            market["sales_alpha"],
            "scenario.market.sales_alpha",
            (axes.markets, years),
        ),
        sales_beta=tensor(
            market["sales_beta"],
            "scenario.market.sales_beta",
            (axes.markets, years),
        ),
    )
