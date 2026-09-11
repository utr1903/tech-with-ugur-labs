"""Labelled report rows computed from physical decisions."""

from __future__ import annotations

from app.contracts import DecisionValues, Scenario
from app.reporting.tables import Cell, Table
from app.verification.common import availability


def people_tables(s: Scenario, d: DecisionValues) -> tuple[Table, ...]:
    headcount = Table(
        "headcount",
        "Headcount and salary",
        ("region", "team", "year", "people", "salary_musd"),
        tuple(
            (
                region,
                team,
                year,
                float(d.headcount[r, k, t]),
                float(s.salary[r, k, t] * d.headcount[r, k, t]),
            )
            for r, region in enumerate(s.axes.regions)
            for k, team in enumerate(s.axes.teams)
            for t, year in enumerate(s.axes.years)
        ),
    )
    rows: list[tuple[Cell, ...]] = []
    upgrades = availability(d.investment_start)
    for r, region in enumerate(s.axes.regions):
        for t, year in enumerate(s.axes.years):
            n = d.headcount[r, 0, t]
            capability = (
                float(
                    (s.rd_alpha[r, t] + s.rd_upgrade_alpha_gain[r] * upgrades[r, t]) * n
                    - s.rd_beta[r, t] * n * n
                )
                if r < 2
                else 0.0
            )
            rows.append(
                (
                    region,
                    year,
                    capability,
                    *(float(d.rd_allocation[r, u, t]) for u in range(3)),
                    float(d.process_saving[t]),
                    float(d.development_stock[t]),
                    float(d.product_active[t]),
                )
            )
    knowledge = Table(
        "rd_and_knowledge",
        "R&D and shared knowledge stocks",
        (
            "region",
            "year",
            "capability",
            "process",
            "development",
            "maintenance",
            "shared_process_saving",
            "shared_development_stock",
            "shared_high_active",
        ),
        tuple(rows),
    )
    return headcount, knowledge
