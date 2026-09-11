"""Independent bounded sales effort, demand, price, and activity checks."""

from __future__ import annotations

import numpy as np

from app.contracts import DecisionValues, Scenario
from app.verification.common import Checks


def check_markets(s: Scenario, d: DecisionValues, c: Checks) -> None:
    effort = s.staff_max[:, 2, None, :] * d.sales_share
    c.compare("sales_share", d.sales_share.sum(axis=1), 1.0)
    c.compare("sales_effort", effort.sum(axis=1), d.headcount[:, 2])
    c.compare("price_min", s.price_min, d.price)
    c.compare("price_max", d.price, s.price_max)
    demand = (
        s.demand_base
        + s.sales_alpha[:, None] * effort
        - s.sales_beta[:, None] * effort**2
        - s.price_sensitivity * (d.price - s.reference_price)
    )
    c.compare("demand", d.sales, demand)
    # Independently maximize the concave effort response over its permitted box.
    effort_max = s.staff_max[:, 2].copy()
    positive = s.sales_beta > 0
    effort_max[positive] = np.minimum(
        effort_max[positive], s.sales_alpha[positive] / (2 * s.sales_beta[positive])
    )
    peak = s.sales_alpha * effort_max - s.sales_beta * effort_max**2
    high_max = (
        s.demand_base[:, 1]
        + peak
        - s.price_sensitivity[:, 1] * (s.price_min[:, 1] - s.reference_price[:, 1])
    )
    c.compare("high_sales_activity", d.sales[:, 1], high_max * d.product_active)
