"""Semantic validation of a loaded scenario, one field path at a time.

`scenario.py` has already proved that every field exists, is the right type
and is finite. What is left is whether the numbers make sense together: a
gross cap no position can ever reach, a return band whose floor sits above
its ceiling, a starting book the desk's own mandate forbids. Each failure
raises `ScenarioError` naming the full YAML path, such as
`desk_limits.name_gross_cap`, so the message points straight at the line to
edit.

This module holds the checks that need the universe — its shape, the desk
mandate and the starting book — and orchestrates the whole pass. The checks
that only need one settings block live in `validation_settings.py`.
"""

from __future__ import annotations

import numpy as np

from app.contracts import DeskLimits, Scenario, Universe
from app.errors import ScenarioError
from app.validation_settings import (
    require_ordered,
    require_positive,
    validate_algorithms,
    validate_frontier,
    validate_market,
    validate_studies,
    validate_tolerances,
)

NAME_COUNT = 30
SECTOR_COUNT = 6
NAMES_PER_SECTOR = 5

# Slack allowed when checking the starting book against the desk limits, so
# a weight written as 0.065 in YAML is not rejected by its own float repr.
_LIMIT_EPSILON = 1e-9


def _validate_universe_shape(universe: Universe) -> None:
    """Check the universe is 30 unique names across 6 sectors of 5."""
    if len(universe.names) != NAME_COUNT:
        raise ScenarioError(
            f"universe.names must list exactly {NAME_COUNT} names, "
            f"got {len(universe.names)}"
        )
    if len(set(universe.names)) != len(universe.names):
        duplicates = sorted({n for n in universe.names if universe.names.count(n) > 1})
        raise ScenarioError(f"universe.names contains duplicates: {duplicates}")
    if len(universe.sectors) != SECTOR_COUNT:
        raise ScenarioError(
            f"universe.sectors must list exactly {SECTOR_COUNT} sectors, "
            f"got {len(universe.sectors)}"
        )
    if len(set(universe.sectors)) != len(universe.sectors):
        raise ScenarioError(f"universe.sectors contains duplicates: {universe.sectors}")

    members = universe.sector_matrix.sum(axis=1)
    wrong = [
        f"{sector}={int(count)}"
        for sector, count in zip(universe.sectors, members, strict=True)
        if int(count) != NAMES_PER_SECTOR
    ]
    if wrong:
        raise ScenarioError(
            f"universe.sectors must each hold exactly {NAMES_PER_SECTOR} names, "
            f"got {wrong}"
        )


def _validate_universe_costs(universe: Universe) -> None:
    """Check no name claims to pay a negative borrow fee or spread."""
    for field, values in (
        ("borrow_fee_annual", universe.borrow_fee_annual),
        ("half_spread", universe.half_spread),
    ):
        negative = [
            name
            for name, value in zip(universe.names, values, strict=True)
            if value < 0
        ]
        if negative:
            raise ScenarioError(
                f"universe.names.{negative[0]}.{field} must be nonnegative"
            )


def _validate_limits(limits: DeskLimits) -> None:
    """Check that the mandate is internally consistent and reachable."""
    require_positive("desk_limits.gross_leverage_max", limits.gross_leverage_max)
    require_positive("desk_limits.name_gross_cap", limits.name_gross_cap)
    require_positive("desk_limits.sector_net_cap", limits.sector_net_cap)
    require_positive("desk_limits.sector_gross_cap", limits.sector_gross_cap)
    require_positive("desk_limits.turnover_max", limits.turnover_max)
    require_ordered(
        "desk_limits.net_exposure_min",
        limits.net_exposure_min,
        "desk_limits.net_exposure_max",
        limits.net_exposure_max,
    )
    require_ordered(
        "desk_limits.beta_min", limits.beta_min, "desk_limits.beta_max", limits.beta_max
    )
    if limits.name_gross_cap * NAME_COUNT < limits.gross_leverage_max:
        raise ScenarioError(
            f"desk_limits.name_gross_cap is unreachable: {NAME_COUNT} names capped at "
            f"{limits.name_gross_cap} can hold at most "
            f"{limits.name_gross_cap * NAME_COUNT} of gross, below "
            f"desk_limits.gross_leverage_max of {limits.gross_leverage_max}"
        )


def _start_book_breaches(universe: Universe, limits: DeskLimits) -> list[str]:
    """List every desk limit the starting book already violates."""
    book = universe.start_book
    gross = float(np.abs(book).sum())
    net = float(book.sum())
    beta = float(universe.market_beta @ book)
    name_gross = float(np.abs(book).max())
    sector_net = float(np.abs(universe.sector_matrix @ book).max())
    sector_gross = float((universe.sector_matrix @ np.abs(book)).max())

    breaches: list[str] = []
    if gross > limits.gross_leverage_max + _LIMIT_EPSILON:
        breaches.append(f"gross {gross:.6f} > {limits.gross_leverage_max}")
    if net < limits.net_exposure_min - _LIMIT_EPSILON:
        breaches.append(f"net {net:.6f} < {limits.net_exposure_min}")
    if net > limits.net_exposure_max + _LIMIT_EPSILON:
        breaches.append(f"net {net:.6f} > {limits.net_exposure_max}")
    if not limits.beta_min - _LIMIT_EPSILON <= beta <= limits.beta_max + _LIMIT_EPSILON:
        breaches.append(
            f"beta {beta:.6f} outside [{limits.beta_min}, {limits.beta_max}]"
        )
    if name_gross > limits.name_gross_cap + _LIMIT_EPSILON:
        breaches.append(f"name gross {name_gross:.6f} > {limits.name_gross_cap}")
    if sector_net > limits.sector_net_cap + _LIMIT_EPSILON:
        breaches.append(f"sector net {sector_net:.6f} > {limits.sector_net_cap}")
    if sector_gross > limits.sector_gross_cap + _LIMIT_EPSILON:
        breaches.append(f"sector gross {sector_gross:.6f} > {limits.sector_gross_cap}")
    return breaches


def _validate_start_book(universe: Universe, limits: DeskLimits) -> None:
    """Check that the book the desk starts from satisfies its own mandate."""
    breaches = _start_book_breaches(universe, limits)
    if breaches:
        raise ScenarioError(
            f"universe.start_book breaches the desk limits: {'; '.join(breaches)}"
        )


def validate_scenario(scenario: Scenario) -> None:
    """Validate every semantic rule the scenario has to satisfy.

    Args:
        scenario: A structurally parsed scenario.

    Raises:
        ScenarioError: Naming the full YAML path of the first rule broken.
    """
    if not 0.0 < scenario.cvar_beta < 1.0:
        raise ScenarioError(
            f"cvar_beta must lie strictly inside (0, 1), got {scenario.cvar_beta}"
        )
    _validate_universe_shape(scenario.universe)
    _validate_universe_costs(scenario.universe)
    _validate_limits(scenario.limits)
    _validate_start_book(scenario.universe, scenario.limits)
    validate_market(scenario.market, scenario.universe)
    validate_frontier(scenario.frontier)
    validate_algorithms(scenario.algorithms)
    validate_studies(scenario.studies)
    validate_tolerances(scenario.tolerances)
