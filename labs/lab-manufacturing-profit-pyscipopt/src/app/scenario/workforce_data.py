"""Conversion of solver, workforce, support, and budget sections."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import Axes, FloatArray, SolverSettings
from app.scenario.parsing import Node, number, require_keys, tensor
from app.scenario.sections import ScenarioSections


@dataclass(frozen=True)
class WorkforceData:
    """Immutable workforce and funding arrays."""

    solver: SolverSettings
    staff_min: FloatArray
    staff_max: FloatArray
    salary: FloatArray
    support_fixed: FloatArray
    support_ratios: FloatArray
    regional_budget: FloatArray
    office_overhead: FloatArray
    investment_cost: FloatArray
    central_allowance: FloatArray


def _staff_array(staff: Node, axes: Axes, field: str) -> FloatArray:
    years = tuple(f"year_{year}" for year in axes.years)
    rows: list[list[list[float]]] = []
    for region in axes.regions:
        teams = require_keys(staff[region], axes.teams, f"scenario.staff.{region}")
        region_rows = []
        for team in axes.teams:
            path = f"scenario.staff.{region}.{team}"
            fields = require_keys(
                teams[team],
                ("minimum", "maximum", "salary_musd_per_person"),
                path,
            )
            values = require_keys(fields[field], years, f"{path}.{field}")
            region_rows.append(
                [number(values[year], f"{path}.{field}.{year}") for year in years]
            )
        rows.append(region_rows)
    result = np.array(rows, dtype=np.float64, copy=True)
    result.flags.writeable = False
    return result


def _solver(root: Node) -> SolverSettings:
    path = "scenario.solver"
    keys = (
        "time_limit_seconds",
        "relative_gap",
        "feasibility_abs",
        "feasibility_rel",
        "integrality_abs",
    )
    node = require_keys(root["solver"], keys, path)
    values = {key: number(node[key], f"{path}.{key}") for key in keys}
    return SolverSettings(**values)


def _investment_cost(sections: ScenarioSections, axes: Axes) -> FloatArray:
    values = np.array(
        [
            number(
                require_keys(
                    sections.investments[name],
                    ("cost_musd",),
                    f"scenario.investments.{name}",
                )["cost_musd"],
                f"scenario.investments.{name}.cost_musd",
            )
            for name in axes.investments
        ],
        dtype=np.float64,
        copy=True,
    )
    values.flags.writeable = False
    return values


def convert_workforce(sections: ScenarioSections, axes: Axes) -> WorkforceData:
    """Convert workforce and funding mappings in canonical axis order."""
    years = tuple(f"year_{year}" for year in axes.years)
    return WorkforceData(
        solver=_solver(sections.root),
        staff_min=_staff_array(sections.staff, axes, "minimum"),
        staff_max=_staff_array(sections.staff, axes, "maximum"),
        salary=_staff_array(sections.staff, axes, "salary_musd_per_person"),
        support_fixed=tensor(
            sections.support["fixed_headcount"],
            "scenario.support.fixed_headcount",
            (axes.regions, years),
        ),
        support_ratios=tensor(
            sections.support["coverage_ratios"],
            "scenario.support.coverage_ratios",
            (axes.regions, ("rd", "manufacturing", "sales"), years),
        ),
        regional_budget=tensor(
            sections.root["regional_budget_musd"],
            "scenario.regional_budget_musd",
            (axes.regions, years),
        ),
        office_overhead=tensor(
            sections.root["office_overhead_musd"],
            "scenario.office_overhead_musd",
            (axes.regions, years),
        ),
        investment_cost=_investment_cost(sections, axes),
        central_allowance=tensor(
            sections.root["central_allowance_musd"],
            "scenario.central_allowance_musd",
            (years,),
        ),
    )
