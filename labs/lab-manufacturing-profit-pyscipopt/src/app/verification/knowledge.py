"""Independent delayed investment and R&D accounting."""

from __future__ import annotations

import numpy as np

from app.contracts import DecisionValues, Scenario
from app.verification.common import Checks, availability


def check_knowledge(s: Scenario, d: DecisionValues, c: Checks) -> None:
    z = d.investment_start
    c.compare("investment_binary", z, 1.0)
    c.compare("investment_once", z.sum(axis=1), 1.0)
    c.compare("investment_final_year", z[:, 2], 0.0, equality=True)
    c.compare(
        "central_allowance",
        np.sum(s.investment_cost[:, None] * z, axis=0),
        s.central_allowance,
    )
    c.compare("product_binary", d.product_active, 1.0)
    n = d.headcount[:2, 0]
    output = (
        s.rd_alpha + s.rd_upgrade_alpha_gain[:, None] * availability(z)[:2]
    ) * n - s.rd_beta * n * n
    c.compare("rd_capacity", d.rd_allocation[:2].sum(axis=1), output)
    c.compare("rd_region", d.rd_allocation[2:], 0.0, equality=True)
    process = np.r_[
        s.initial_process_saving,
        d.process_saving[:-1]
        + s.process_conversion[:-1] * d.rd_allocation[:, 0, :-1].sum(axis=0),
    ]
    development = np.r_[
        s.initial_development_stock,
        d.development_stock[:-1] + d.rd_allocation[:, 1, :-1].sum(axis=0),
    ]
    c.compare("process_recurrence", d.process_saving, process, equality=True)
    c.compare(
        "process_max",
        d.process_saving,
        min(s.max_process_saving, 1 - s.material_saving_floor),
    )
    c.compare("development_recurrence", d.development_stock, development, equality=True)
    c.compare("development_max", d.development_stock, s.max_development_stock)
    c.compare(
        "development_prerequisite",
        s.development_threshold * d.product_active,
        d.development_stock,
    )
    c.compare(
        "maintenance",
        s.maintenance_required * d.product_active,
        d.rd_allocation[:, 2].sum(axis=0),
    )
