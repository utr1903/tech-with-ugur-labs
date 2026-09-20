"""Semantic validation of a loaded scenario, one field path at a time.

`scenario.py` has already proved that every field exists, is the right type
and is finite. What is left is whether the numbers make sense together: a
gross cap no position can ever reach, a return band whose floor sits above
its ceiling, a starting book the desk's own mandate forbids. Each failure
raises `ScenarioError` naming the full YAML path, such as
`desk_limits.name_gross_cap`, so the message points straight at the line to
edit.
"""

from __future__ import annotations

import numpy as np

from app.contracts import (
    AlgorithmSettings,
    DeskLimits,
    FrontierSettings,
    GeneratorSettings,
    Scenario,
    StudySettings,
    Tolerances,
    Universe,
)
from app.errors import ScenarioError

NAME_COUNT = 30
SECTOR_COUNT = 6
NAMES_PER_SECTOR = 5
MIN_SCENARIOS = 100
MIN_FRONTIER_POINTS = 2
MIN_STYLE_FACTORS = 2
MIN_STUDY_SEEDS = 2
MIN_DEGREES_OF_FREEDOM = 2.0

# Slack allowed when checking the starting book against the desk limits, so
# a weight written as 0.065 in YAML is not rejected by its own float repr.
_LIMIT_EPSILON = 1e-9


def _require_positive(path: str, value: float) -> None:
    """Require a scale, cap, budget or tolerance to be strictly positive."""
    if value <= 0.0:
        raise ScenarioError(f"{path} must be greater than zero, got {value}")


def _require_probability(path: str, value: float) -> None:
    """Require a probability in `[0, 1)`, excluding the always-on case."""
    if not 0.0 <= value < 1.0:
        raise ScenarioError(f"{path} must lie in [0, 1), got {value}")


def _require_ordered(low_path: str, low: float, high_path: str, high: float) -> None:
    """Require a band's floor to sit at or below its ceiling."""
    if low > high:
        raise ScenarioError(
            f"{low_path} must not exceed {high_path}, got {low} > {high}"
        )


def _validate_universe(universe: Universe) -> None:
    """Check the shape of the universe and every per-name economic input."""
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

    for path, values in (
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
                f"universe.names.{negative[0]}.{path} must be nonnegative"
            )


def _validate_limits(limits: DeskLimits) -> None:
    """Check that the mandate is internally consistent and reachable."""
    _require_positive("desk_limits.gross_leverage_max", limits.gross_leverage_max)
    _require_positive("desk_limits.name_gross_cap", limits.name_gross_cap)
    _require_positive("desk_limits.sector_net_cap", limits.sector_net_cap)
    _require_positive("desk_limits.sector_gross_cap", limits.sector_gross_cap)
    _require_positive("desk_limits.turnover_max", limits.turnover_max)
    _require_ordered(
        "desk_limits.net_exposure_min",
        limits.net_exposure_min,
        "desk_limits.net_exposure_max",
        limits.net_exposure_max,
    )
    _require_ordered(
        "desk_limits.beta_min", limits.beta_min, "desk_limits.beta_max", limits.beta_max
    )
    if limits.name_gross_cap * NAME_COUNT < limits.gross_leverage_max:
        raise ScenarioError(
            f"desk_limits.name_gross_cap is unreachable: {NAME_COUNT} names capped at "
            f"{limits.name_gross_cap} can hold at most "
            f"{limits.name_gross_cap * NAME_COUNT} of gross, below "
            f"desk_limits.gross_leverage_max of {limits.gross_leverage_max}"
        )


def _validate_start_book(universe: Universe, limits: DeskLimits) -> None:
    """Check that the book the desk starts from satisfies its own mandate."""
    book = universe.start_book
    gross = float(np.abs(book).sum())
    net = float(book.sum())
    beta = float(universe.market_beta @ book)
    breaches: list[str] = []
    if gross > limits.gross_leverage_max + _LIMIT_EPSILON:
        breaches.append(f"gross {gross:.6f} > {limits.gross_leverage_max}")
    if not limits.net_exposure_min - _LIMIT_EPSILON <= net:
        breaches.append(f"net {net:.6f} < {limits.net_exposure_min}")
    if net > limits.net_exposure_max + _LIMIT_EPSILON:
        breaches.append(f"net {net:.6f} > {limits.net_exposure_max}")
    if not limits.beta_min - _LIMIT_EPSILON <= beta <= limits.beta_max + _LIMIT_EPSILON:
        breaches.append(
            f"beta {beta:.6f} outside [{limits.beta_min}, {limits.beta_max}]"
        )
    if float(np.abs(book).max()) > limits.name_gross_cap + _LIMIT_EPSILON:
        breaches.append(f"name gross {float(np.abs(book).max()):.6f}")
    sector_net = float(np.abs(universe.sector_matrix @ book).max())
    if sector_net > limits.sector_net_cap + _LIMIT_EPSILON:
        breaches.append(f"sector net {sector_net:.6f} > {limits.sector_net_cap}")
    sector_gross = float((universe.sector_matrix @ np.abs(book)).max())
    if sector_gross > limits.sector_gross_cap + _LIMIT_EPSILON:
        breaches.append(f"sector gross {sector_gross:.6f} > {limits.sector_gross_cap}")
    if breaches:
        raise ScenarioError(
            f"universe.start_book breaches the desk limits: {'; '.join(breaches)}"
        )


def _validate_market(market: GeneratorSettings, universe: Universe) -> None:
    """Check the generator settings, including the jump-name cross-reference."""
    if market.mode not in ("fat_tailed", "gaussian"):
        raise ScenarioError(
            f"market.mode must be 'fat_tailed' or 'gaussian', got {market.mode!r}"
        )
    for path, count in (
        ("market.scenarios", market.scenarios),
        ("market.out_of_sample_scenarios", market.out_of_sample_scenarios),
    ):
        if count < MIN_SCENARIOS:
            raise ScenarioError(
                f"{path} must be at least {MIN_SCENARIOS} for a usable tail, "
                f"got {count}"
            )
    if market.factor_count < MIN_STYLE_FACTORS:
        raise ScenarioError(
            f"market.factor_count must be at least {MIN_STYLE_FACTORS} so a sector "
            f"and its neighbour load on different style factors, "
            f"got {market.factor_count}"
        )
    _require_positive("market.calm_sigma", market.calm_sigma)
    _require_positive("market.stress_sigma", market.stress_sigma)
    _require_positive("market.idiosyncratic_sigma", market.idiosyncratic_sigma)
    _require_positive("market.jump_sigma", market.jump_sigma)
    _require_probability("market.stress_probability", market.stress_probability)
    _require_probability("market.jump_probability", market.jump_probability)
    if market.stress_mean > 0.0:
        raise ScenarioError(
            f"market.stress_mean is the stressed market's mean return and must not be "
            f"positive, got {market.stress_mean}"
        )
    if market.jump_mean > 0.0:
        raise ScenarioError(
            f"market.jump_mean is a one-sided crash and must not be positive, "
            f"got {market.jump_mean}"
        )
    if market.idiosyncratic_df <= MIN_DEGREES_OF_FREEDOM:
        raise ScenarioError(
            f"market.idiosyncratic_df must exceed {MIN_DEGREES_OF_FREEDOM} for the "
            f"Student-t to have a finite variance, got {market.idiosyncratic_df}"
        )
    unknown = sorted(set(market.jump_names) - set(universe.names))
    if unknown:
        raise ScenarioError(f"market.jump_names lists unknown names: {unknown}")
    if len(set(market.jump_names)) != len(market.jump_names):
        raise ScenarioError(f"market.jump_names repeats a name: {market.jump_names}")


def _validate_frontier(frontier: FrontierSettings) -> None:
    """Check the return-target sweep has at least two ordered points."""
    if frontier.points < MIN_FRONTIER_POINTS:
        raise ScenarioError(
            f"frontier.points must be at least {MIN_FRONTIER_POINTS} to draw a "
            f"frontier, got {frontier.points}"
        )
    _require_ordered(
        "frontier.min_target_monthly",
        frontier.min_target_monthly,
        "frontier.max_target_monthly",
        frontier.max_target_monthly,
    )


def _validate_algorithms(algorithms: AlgorithmSettings) -> None:
    """Check the scenario ladder climbs, so timings can be compared in order."""
    ladder = algorithms.scenario_ladder
    if not ladder:
        raise ScenarioError("algorithms.scenario_ladder must list at least one count")
    if any(count < 1 for count in ladder):
        raise ScenarioError(
            f"algorithms.scenario_ladder counts must be positive: {ladder}"
        )
    if any(
        later <= earlier for earlier, later in zip(ladder, ladder[1:], strict=False)
    ):
        raise ScenarioError(
            f"algorithms.scenario_ladder must increase strictly, got {ladder}"
        )
    _require_positive(
        "algorithms.objective_relative_tolerance",
        algorithms.objective_relative_tolerance,
    )


def _validate_studies(studies: StudySettings) -> None:
    """Check the comparison studies average over enough seeds to mean anything."""
    if studies.seeds < MIN_STUDY_SEEDS:
        raise ScenarioError(
            f"studies.seeds must be at least {MIN_STUDY_SEEDS} to average over, "
            f"got {studies.seeds}"
        )
    if studies.scenarios < MIN_SCENARIOS:
        raise ScenarioError(
            f"studies.scenarios must be at least {MIN_SCENARIOS}, "
            f"got {studies.scenarios}"
        )
    _require_positive(
        "studies.elliptical_weight_tolerance", studies.elliptical_weight_tolerance
    )
    if studies.divergence_ratio_min <= 1.0:
        raise ScenarioError(
            f"studies.divergence_ratio_min must exceed 1.0 for the fat-tailed "
            f"market to count as more divergent than the control, got "
            f"{studies.divergence_ratio_min}"
        )


def _validate_tolerances(tolerances: Tolerances) -> None:
    """Check every check tolerance is a positive slack rather than a switch."""
    for path, value in (
        ("tolerances.constraint_abs", tolerances.constraint_abs),
        ("tolerances.cvar_agreement_abs", tolerances.cvar_agreement_abs),
        ("tolerances.var_recovery_abs", tolerances.var_recovery_abs),
        ("tolerances.solver_agreement_rel", tolerances.solver_agreement_rel),
        ("tolerances.relaxation_abs", tolerances.relaxation_abs),
        ("tolerances.dual_relative", tolerances.dual_relative),
    ):
        _require_positive(path, value)


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
    _validate_universe(scenario.universe)
    _validate_limits(scenario.limits)
    _validate_start_book(scenario.universe, scenario.limits)
    _validate_market(scenario.market, scenario.universe)
    _validate_frontier(scenario.frontier)
    _validate_algorithms(scenario.algorithms)
    _validate_studies(scenario.studies)
    _validate_tolerances(scenario.tolerances)
