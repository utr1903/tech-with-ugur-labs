"""Semantic checks for the five settings blocks, plus the rules they share.

`validation.py` owns the checks that need the universe — the names, the
desk mandate and the starting book. This module owns the ones that only
need a settings block: the generator, the frontier sweep, the algorithm
ladder, the comparison studies and the check tolerances.

The three small `require_*` rules at the top live here rather than next
door so the dependency runs one way: `validation` imports this module, and
this module imports nothing of `validation`.
"""

from __future__ import annotations

from app.contracts import (
    AlgorithmSettings,
    FrontierSettings,
    GeneratorSettings,
    StudySettings,
    Tolerances,
    Universe,
)
from app.errors import ScenarioError
from app.market import MODES

MIN_SCENARIOS = 100
MIN_FRONTIER_POINTS = 2
MIN_STYLE_FACTORS = 2
MIN_STUDY_SEEDS = 2
MIN_DEGREES_OF_FREEDOM = 2.0


def require_positive(path: str, value: float) -> None:
    """Require a scale, cap, budget or tolerance to be strictly positive."""
    if value <= 0.0:
        raise ScenarioError(f"{path} must be greater than zero, got {value}")


def require_probability(path: str, value: float) -> None:
    """Require a probability in `[0, 1)`, excluding the always-on case."""
    if not 0.0 <= value < 1.0:
        raise ScenarioError(f"{path} must lie in [0, 1), got {value}")


def require_ordered(low_path: str, low: float, high_path: str, high: float) -> None:
    """Require a band's floor to sit at or below its ceiling."""
    if low > high:
        raise ScenarioError(
            f"{low_path} must not exceed {high_path}, got {low} > {high}"
        )


def _validate_market_shape(market: GeneratorSettings) -> None:
    """Check the mode, the sample sizes and the style-factor count."""
    if market.mode not in MODES:
        raise ScenarioError(
            f"market.mode must be one of {list(MODES)}, got {market.mode!r}"
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


def _validate_market_shocks(market: GeneratorSettings) -> None:
    """Check every shock component can produce a finite, one-sided tail."""
    require_positive("market.calm_sigma", market.calm_sigma)
    require_positive("market.stress_sigma", market.stress_sigma)
    require_positive("market.idiosyncratic_sigma", market.idiosyncratic_sigma)
    require_positive("market.jump_sigma", market.jump_sigma)
    require_probability("market.stress_probability", market.stress_probability)
    require_probability("market.jump_probability", market.jump_probability)
    if market.stress_mean > 0.0:
        raise ScenarioError(
            f"market.stress_mean is the stressed market's mean return and must not "
            f"be positive, got {market.stress_mean}"
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


def validate_market(market: GeneratorSettings, universe: Universe) -> None:
    """Check the generator settings, including the jump-name cross-reference."""
    _validate_market_shape(market)
    _validate_market_shocks(market)
    unknown = sorted(set(market.jump_names) - set(universe.names))
    if unknown:
        raise ScenarioError(f"market.jump_names lists unknown names: {unknown}")
    if len(set(market.jump_names)) != len(market.jump_names):
        raise ScenarioError(f"market.jump_names repeats a name: {market.jump_names}")


def validate_frontier(frontier: FrontierSettings) -> None:
    """Check the return-target sweep has at least two ordered points."""
    if frontier.points < MIN_FRONTIER_POINTS:
        raise ScenarioError(
            f"frontier.points must be at least {MIN_FRONTIER_POINTS} to draw a "
            f"frontier, got {frontier.points}"
        )
    require_ordered(
        "frontier.min_target_monthly",
        frontier.min_target_monthly,
        "frontier.max_target_monthly",
        frontier.max_target_monthly,
    )


def validate_algorithms(algorithms: AlgorithmSettings) -> None:
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
    require_positive(
        "algorithms.objective_relative_tolerance",
        algorithms.objective_relative_tolerance,
    )


def validate_studies(studies: StudySettings) -> None:
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
    require_positive(
        "studies.elliptical_weight_tolerance", studies.elliptical_weight_tolerance
    )
    if studies.divergence_ratio_min <= 1.0:
        raise ScenarioError(
            f"studies.divergence_ratio_min must exceed 1.0 for the fat-tailed "
            f"market to count as more divergent than the control, got "
            f"{studies.divergence_ratio_min}"
        )


def validate_tolerances(tolerances: Tolerances) -> None:
    """Check every check tolerance is a positive slack rather than a switch."""
    for path, value in (
        ("tolerances.constraint_abs", tolerances.constraint_abs),
        ("tolerances.cvar_agreement_abs", tolerances.cvar_agreement_abs),
        ("tolerances.var_recovery_abs", tolerances.var_recovery_abs),
        ("tolerances.solver_agreement_rel", tolerances.solver_agreement_rel),
        ("tolerances.relaxation_abs", tolerances.relaxation_abs),
        ("tolerances.dual_relative", tolerances.dual_relative),
    ):
        require_positive(path, value)
