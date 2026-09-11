"""Labelled report rows computed from physical decisions."""

from __future__ import annotations

import numpy as np

from app.contracts import DecisionValues, Scenario
from app.reporting.tables import Table
from app.verification.cash import compute_costs
from app.verification.common import availability


def operating_tables(s: Scenario, d: DecisionValues) -> tuple[Table, ...]:
    market = Table(
        "market_plan",
        "Market plan",
        (
            "market",
            "product",
            "year",
            "sales_share",
            "effort_people",
            "price_usd_per_unit",
            "sales_volume",
            "revenue_musd",
        ),
        tuple(
            (
                market,
                product,
                year,
                float(d.sales_share[m, p, t]),
                float(s.staff_max[m, 2, t] * d.sales_share[m, p, t]),
                float(d.price[m, p, t] * 1_000_000),
                float(d.sales[m, p, t]),
                float(d.price[m, p, t] * d.sales[m, p, t]),
            )
            for m, market in enumerate(s.axes.markets)
            for p, product in enumerate(s.axes.products)
            for t, year in enumerate(s.axes.years)
        ),
    )
    costs = compute_costs(s, d)
    opened = np.stack((np.ones(3), availability(d.investment_start)[3]))
    factory = Table(
        "factory_plan",
        "Factory plan (factory totals repeat per product)",
        (
            "factory",
            "product",
            "year",
            "production_volume",
            "factory_open",
            "factory_electricity_use",
            "factory_exact_electricity_musd",
            "factory_electricity_auxiliary_musd",
            "factory_material_musd",
            "factory_shipping_musd",
            "factory_overhead_musd",
        ),
        tuple(
            (
                factory,
                product,
                year,
                float(d.production[f, p, t]),
                float(opened[f, t]),
                float(costs.energy[f, t]),
                float(costs.electricity[f, t]),
                float(d.electricity_cost[f, t]),
                float(costs.materials[f, t]),
                float(costs.shipping[f, t]),
                float(costs.factory_overhead[f, t]),
            )
            for f, factory in enumerate(s.axes.factories)
            for p, product in enumerate(s.axes.products)
            for t, year in enumerate(s.axes.years)
        ),
    )
    shipments = Table(
        "shipments",
        "Shipments",
        ("factory", "market", "product", "year", "volume", "shipping_musd"),
        tuple(
            (
                factory,
                market,
                product,
                year,
                float(d.shipment[f, m, p, t]),
                float(s.shipping_cost[f, m, p] * d.shipment[f, m, p, t]),
            )
            for f, factory in enumerate(s.axes.factories)
            for m, market in enumerate(s.axes.markets)
            for p, product in enumerate(s.axes.products)
            for t, year in enumerate(s.axes.years)
        ),
    )
    return market, factory, shipments
