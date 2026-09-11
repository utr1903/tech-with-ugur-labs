"""Cash computed directly from physical decisions, with exact marginal tariffs."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import DecisionValues, FloatArray, Scenario
from app.verification.common import CashBreakdown, availability


@dataclass(frozen=True)
class Costs:
    cash: CashBreakdown
    regional: FloatArray
    energy: FloatArray
    electricity: FloatArray
    materials: FloatArray
    shipping: FloatArray
    factory_overhead: FloatArray


def exact_tariff(scenario: Scenario, energy: FloatArray) -> FloatArray:
    thresholds = scenario.tariff.thresholds
    widths = np.diff(thresholds, axis=1)
    used = np.minimum(
        np.maximum(energy[:, :, None] - thresholds[:, None, :-1], 0), widths[:, None, :]
    )
    # Extrapolate the final marginal block for diagnostics of invalid decisions.
    bill = np.sum(used * scenario.tariff.marginal_rates[:, None, :], axis=2)
    return (
        bill
        + np.maximum(energy - thresholds[:, -1, None], 0)
        * scenario.tariff.marginal_rates[:, -1, None]
    )


def compute_costs(s: Scenario, d: DecisionValues) -> Costs:
    opened = np.stack((np.ones(3), availability(d.investment_start)[3]))
    energy = s.factory_baseline_electricity * opened + np.sum(
        s.electricity_per_unit[:, :, None] * d.production, axis=1
    )
    electricity = exact_tariff(s, energy)
    materials = (
        s.material_price
        * np.sum(s.material_requirement[:, :, None] * d.production, axis=1)
        * (1 - d.process_saving)
    )
    shipping = np.sum(s.shipping_cost[:, :, :, None] * d.shipment, axis=(1, 2))
    overhead = s.factory_overhead * opened
    salaries = np.sum(s.salary * d.headcount, axis=1)
    regional = salaries + s.office_overhead
    regional[2:] += materials + electricity + shipping + overhead
    revenue = np.sum(d.price * d.sales, axis=(0, 1))
    investment = np.sum(s.investment_cost[:, None] * d.investment_start, axis=0)
    cash = CashBreakdown(
        revenue,
        salaries.sum(axis=0),
        materials.sum(axis=0),
        electricity.sum(axis=0),
        s.office_overhead.sum(axis=0),
        overhead.sum(axis=0),
        shipping.sum(axis=0),
        investment,
        revenue - regional.sum(axis=0) - investment,
    )
    return Costs(cash, regional, energy, electricity, materials, shipping, overhead)
