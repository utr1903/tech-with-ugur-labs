"""Independent staffing, factory, flow, and energy checks."""

from __future__ import annotations

import numpy as np

from app.contracts import DecisionValues, Scenario
from app.verification.cash import Costs
from app.verification.common import Checks, availability


def check_operations(s: Scenario, d: DecisionValues, costs: Costs, c: Checks) -> None:
    upgrades = availability(d.investment_start)
    opened = np.stack((np.ones(3), upgrades[3]))
    minimum, maximum = s.staff_min.copy(), s.staff_max.copy()
    minimum[3, 1] *= opened[1]
    maximum[3, 1] *= opened[1]
    c.compare("staff_min", minimum, d.headcount)
    c.compare("staff_max", d.headcount, maximum)
    support = s.support_fixed + np.sum(s.support_ratios * d.headcount[:, :3], axis=1)
    c.compare("support_coverage", support, d.headcount[:, 3])
    capacity = s.factory_capacity * opened
    capacity[0] += s.germany_capacity_gain * upgrades[2]
    c.compare("factory_capacity", d.production.sum(axis=1), capacity)
    c.compare(
        "labor_capacity",
        np.sum(s.manufacturing_effort[:, :, None] * d.production, axis=1),
        s.manufacturing_productivity * d.headcount[2:, 1],
    )
    maximum_capacity = s.factory_capacity.copy()
    maximum_capacity[0] += s.germany_capacity_gain
    high_max = np.minimum(
        maximum_capacity,
        s.manufacturing_productivity
        * s.staff_max[2:, 1]
        / s.manufacturing_effort[:, 1, None],
    ).sum(axis=0)
    c.compare(
        "high_production_activity",
        d.production[:, 1].sum(axis=0),
        high_max * d.product_active,
    )
    c.compare(
        "production_outbound_balance",
        d.production,
        d.shipment.sum(axis=1),
        equality=True,
    )
    c.compare("sales_inbound_balance", d.sales, d.shipment.sum(axis=0), equality=True)
    c.compare("electricity_use", d.electricity_use, costs.energy, equality=True)
    c.compare("electricity_epigraph", costs.electricity, d.electricity_cost)
    c.compare("regional_budget", costs.regional, s.regional_budget)
    c.compare("cash_auxiliary", d.cash_auxiliary, float(costs.cash.net_cash.sum()))
