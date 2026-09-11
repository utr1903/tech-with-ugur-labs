"""Independent finite domains for auxiliaries that may legitimately be slack."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import DecisionValues, FloatArray, Scenario
from app.verification.common import Checks
from app.verification.markets import maximum_demand


@dataclass(frozen=True)
class AuxiliaryLimits:
    electricity_cost_max: FloatArray
    cash_min: float


def _possible_investment(s: Scenario, investment: int) -> FloatArray:
    """An investment can help only after an individually affordable start year."""
    possible = np.zeros(len(s.axes.years))
    for year in range(1, len(s.axes.years)):
        possible[year] = float(
            any(s.investment_cost[investment] <= s.central_allowance[:year])
        )
    return possible


def auxiliary_limits(s: Scenario) -> AuxiliaryLimits:
    """Rebuild the finite model envelopes from data, without model/bound imports."""
    opened = np.stack((np.ones(3), _possible_investment(s, 3)))
    physical = s.factory_capacity * opened
    physical[0] += s.germany_capacity_gain * _possible_investment(s, 2)
    labor = (
        s.manufacturing_productivity
        * s.staff_max[2:, 1]
        / s.manufacturing_effort.min(axis=1)[:, None]
        * opened
    )
    production = np.minimum(physical, labor)
    energy = (
        s.factory_baseline_electricity * opened
        + s.electricity_per_unit.max(axis=1)[:, None] * production
    )
    electricity_max = energy * s.tariff.marginal_rates[:, -1, None]
    material = (
        s.material_requirement.max(axis=1)[:, None] * s.material_price * production
    )
    shipping = s.shipping_cost.max(axis=(1, 2))[:, None] * production
    # The deliberately conservative absolute envelope includes revenue as well as
    # costs, ignores savings, and allows all fixed costs and maximum staffing.
    cash_envelope = float(
        np.sum(s.price_max * maximum_demand(s))
        + np.sum(s.salary * s.staff_max)
        + np.sum(s.office_overhead)
        + np.sum(s.factory_overhead)
        + np.sum(s.investment_cost)
        + np.sum(material)
        + np.sum(shipping)
        + np.sum(electricity_max)
    )
    return AuxiliaryLimits(electricity_max, -cash_envelope)


def check_auxiliary_domains(s: Scenario, d: DecisionValues, c: Checks) -> None:
    limits = auxiliary_limits(s)
    c.compare(
        "electricity_upper_bound", d.electricity_cost, limits.electricity_cost_max
    )
    c.compare("cash_lower_bound", limits.cash_min, d.cash_auxiliary)
