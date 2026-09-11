"""Labelled report rows computed from physical decisions."""

from __future__ import annotations

from dataclasses import fields

from app.contracts import DecisionValues, Scenario
from app.reporting.operations import operating_tables
from app.reporting.people import people_tables
from app.reporting.tables import Cell, Table
from app.verification import VerificationReport
from app.verification.common import availability


def financial_tables(
    s: Scenario, d: DecisionValues, v: VerificationReport
) -> tuple[Table, ...]:
    cash_names = tuple(f.name for f in fields(v.cash))
    cash = Table(
        "annual_cash",
        "Annual cash (MUSD)",
        ("year", *(f"{n}_musd" for n in cash_names)),
        tuple(
            (year, *(float(getattr(v.cash, n)[t]) for n in cash_names))
            for t, year in enumerate(s.axes.years)
        ),
    )
    rows: list[tuple[Cell, ...]] = []
    for r, region in enumerate((*s.axes.regions, "central")):
        for t, year in enumerate(s.axes.years):
            used = (
                float(v.regional_cost[r, t]) if r < 4 else float(v.cash.investment[t])
            )
            limit = (
                float(s.regional_budget[r, t])
                if r < 4
                else float(s.central_allowance[t])
            )
            rows.append(
                (
                    region,
                    year,
                    used,
                    limit,
                    limit - used,
                    used / limit if limit else 0.0,
                )
            )
    budgets = Table(
        "budget_utilization",
        "Annual authorization budgets",
        (
            "region",
            "year",
            "used_musd",
            "limit_musd",
            "remaining_musd",
            "fraction_used",
        ),
        tuple(rows),
    )
    available = availability(d.investment_start)
    investments = Table(
        "investments",
        "Investment timing",
        ("investment", "year", "start", "available", "capex_musd"),
        tuple(
            (
                name,
                year,
                float(d.investment_start[i, t]),
                float(available[i, t]),
                float(s.investment_cost[i] * d.investment_start[i, t]),
            )
            for i, name in enumerate(s.axes.investments)
            for t, year in enumerate(s.axes.years)
        ),
    )
    return cash, budgets, investments


def build_tables(
    s: Scenario, d: DecisionValues, v: VerificationReport
) -> tuple[Table, ...]:
    return (*financial_tables(s, d, v), *people_tables(s, d), *operating_tables(s, d))
