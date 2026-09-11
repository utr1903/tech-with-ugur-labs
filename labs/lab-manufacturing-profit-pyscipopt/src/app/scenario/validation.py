"""Semantic checks that keep the nonlinear model bounded and physical."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from app.contracts import Scenario
from app.errors import ScenarioError
from app.scenario.domain_validation import validate_coefficient_domains
from app.scenario.physical_validation import validate_physical_domain


def _first(condition: npt.NDArray[np.bool_]) -> tuple[int, ...] | None:
    matches = np.argwhere(condition)
    return tuple(int(position) for position in matches[0]) if matches.size else None


def _validate_solver(scenario: Scenario) -> None:
    settings = scenario.solver
    for name in (
        "time_limit_seconds",
        "feasibility_abs",
        "feasibility_rel",
        "integrality_abs",
    ):
        if getattr(settings, name) <= 0:
            raise ScenarioError(f"scenario.solver.{name}: must be positive")
    if not 0 <= settings.relative_gap < 1:
        raise ScenarioError(
            "scenario.solver.relative_gap: must be at least 0 and below 1"
        )


def _validate_staff(scenario: Scenario) -> None:
    axes = scenario.axes
    for values, field in (
        (scenario.staff_min, "minimum"),
        (scenario.staff_max, "maximum"),
    ):
        negative = _first(values < 0)
        if negative is not None:
            region, team, year = negative
            raise ScenarioError(
                f"scenario.staff.{axes.regions[region]}.{axes.teams[team]}."
                f"{field}.year_{year + 1}: must be nonnegative"
            )
        fractional = _first(values != np.floor(values))
        if fractional is not None:
            region, team, year = fractional
            raise ScenarioError(
                f"scenario.staff.{axes.regions[region]}.{axes.teams[team]}."
                f"{field}.year_{year + 1}: must be an integer"
            )
    bad = np.argwhere(scenario.staff_min > scenario.staff_max)
    if bad.size:
        region, team, year = (int(value) for value in bad[0])
        raise ScenarioError(
            "scenario.staff."
            f"{axes.regions[region]}.{axes.teams[team]}.minimum.year_{year + 1}: "
            "must not exceed maximum"
        )
    _validate_team_domains(scenario)


def _validate_team_domains(scenario: Scenario) -> None:
    axes = scenario.axes
    allowed = {
        "us": {"rd", "sales", "support"},
        "india": {"rd", "sales", "support"},
        "germany": {"manufacturing", "sales", "support"},
        "china": {"manufacturing", "sales", "support"},
    }
    for region, region_name in enumerate(axes.regions):
        for team, team_name in enumerate(axes.teams):
            is_allowed = team_name in allowed[region_name]
            for year, year_name in enumerate(axes.years):
                path = f"scenario.staff.{region_name}.{team_name}"
                minimum = scenario.staff_min[region, team, year]
                maximum = scenario.staff_max[region, team, year]
                if not is_allowed and (minimum != 0 or maximum != 0):
                    field = "minimum" if minimum != 0 else "maximum"
                    raise ScenarioError(
                        f"{path}.{field}.year_{year_name}: disallowed team must be zero"
                    )
                if is_allowed and (minimum <= 0 or maximum <= 0):
                    raise ScenarioError(
                        f"{path}.minimum.year_{year_name}: "
                        "allowed team bounds must be positive"
                    )
                salary = scenario.salary[region, team, year]
                if (is_allowed and salary <= 0) or (not is_allowed and salary != 0):
                    raise ScenarioError(
                        f"{path}.salary_musd_per_person.year_{year_name}: "
                        "invalid salary"
                    )


def _validate_knowledge(scenario: Scenario) -> None:
    values = (
        (scenario.initial_process_saving, "initial_process_saving"),
        (scenario.max_process_saving, "max_process_saving"),
        (scenario.material_saving_floor, "material_saving_floor"),
        (scenario.initial_development_stock, "initial_development_stock"),
        (scenario.max_development_stock, "max_development_stock"),
        (scenario.development_threshold, "development_threshold"),
    )
    for value, name in values:
        if value < 0:
            raise ScenarioError(f"scenario.knowledge.{name}: must be nonnegative")
    if not 0 < scenario.material_saving_floor <= 1:
        raise ScenarioError(
            "scenario.knowledge.material_saving_floor: must be above 0 and at most 1"
        )
    if scenario.max_development_stock <= 0:
        raise ScenarioError(
            "scenario.knowledge.max_development_stock: must be positive"
        )
    if scenario.development_threshold <= 0:
        raise ScenarioError(
            "scenario.knowledge.development_threshold: must be positive"
        )
    if scenario.initial_process_saving > scenario.max_process_saving:
        raise ScenarioError(
            "scenario.knowledge.initial_process_saving: must not exceed maximum"
        )
    if scenario.max_process_saving > 1 - scenario.material_saving_floor:
        raise ScenarioError(
            "scenario.knowledge.max_process_saving: leaves less than the physical floor"
        )
    if scenario.initial_development_stock > scenario.max_development_stock:
        raise ScenarioError(
            "scenario.knowledge.initial_development_stock: must not exceed maximum"
        )
    if scenario.development_threshold > scenario.max_development_stock:
        raise ScenarioError(
            "scenario.knowledge.development_threshold: must not exceed maximum stock"
        )


def validate_scenario(scenario: Scenario) -> None:
    """Reject coefficients that violate the model's bounded physical domain."""
    _validate_solver(scenario)
    _validate_staff(scenario)
    _validate_knowledge(scenario)
    validate_coefficient_domains(scenario)
    bad_price = _first(scenario.price_min > scenario.price_max)
    if bad_price is not None:
        market, product, year = bad_price
        raise ScenarioError(
            "scenario.market.price_max_musd_per_unit."
            f"{scenario.axes.markets[market]}.{scenario.axes.products[product]}."
            f"year_{year + 1}: must be at least the minimum price"
        )
    validate_physical_domain(scenario)
