"""Every value object that crosses a module boundary in this lab.

The dataclasses below are frozen and every array they hold is a read-only
copy, so a portfolio, a scenario matrix or a verification report can be
passed around without any module being able to edit another module's data.

Axis conventions, used unchanged everywhere: ``N`` is the number of names
(30), ``K`` the number of sectors (6) and ``S`` the number of return
scenarios. A ``[S, N]`` matrix therefore has one row per scenario and one
column per name.

This file runs past the length the lab's other modules are held to, and
deliberately so: it is declarations only, with no logic to follow and
nothing to step through. Splitting it would scatter one coherent set of
contracts across several imports and make the shapes harder, not easier,
to read side by side.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]


def frozen_float_array(values: npt.ArrayLike) -> FloatArray:
    """Copy `values` into a read-only float64 array."""
    array = np.array(values, dtype=np.float64, copy=True)
    array.setflags(write=False)
    return array


def frozen_int_array(values: npt.ArrayLike) -> IntArray:
    """Copy `values` into a read-only int64 array."""
    array = np.array(values, dtype=np.int64, copy=True)
    array.setflags(write=False)
    return array


@dataclass(frozen=True)
class Universe:
    """The 30 tradable names, their sector map and their per-name economics.

    `expected_return` is the model's view of a name's one-month return. The
    loader derives it as `alpha_monthly + market_beta * market_factor_mean`
    so the scenario file and the generator cannot drift apart; the solve
    itself uses the sample mean of the drawn matrix instead, and
    verification reports both.
    """

    names: tuple[str, ...]
    sectors: tuple[str, ...]
    sector_of: IntArray
    sector_matrix: FloatArray
    market_beta: FloatArray
    expected_return: FloatArray
    borrow_fee_annual: FloatArray
    half_spread: FloatArray
    start_book: FloatArray


@dataclass(frozen=True)
class DeskLimits:
    """The mandate the book has to satisfy, all in fractions of NAV."""

    gross_leverage_max: float
    net_exposure_min: float
    net_exposure_max: float
    beta_min: float
    beta_max: float
    name_gross_cap: float
    sector_net_cap: float
    sector_gross_cap: float
    turnover_max: float


@dataclass(frozen=True)
class GeneratorSettings:
    """Every knob of the seeded factor model, in one-month return units."""

    mode: str
    seed: int
    scenarios: int
    out_of_sample_seed: int
    out_of_sample_scenarios: int
    factor_count: int
    calm_sigma: float
    stress_probability: float
    stress_mean: float
    stress_sigma: float
    idiosyncratic_df: float
    idiosyncratic_sigma: float
    jump_probability: float
    jump_mean: float
    jump_sigma: float
    jump_names: tuple[str, ...]


@dataclass(frozen=True)
class FrontierSettings:
    """The return-target grid swept to trace the risk/return frontier."""

    points: int
    min_target_monthly: float
    max_target_monthly: float


@dataclass(frozen=True)
class AlgorithmSettings:
    """Scenario counts and the agreement tolerance for the solver bake-off."""

    scenario_ladder: tuple[int, ...]
    objective_relative_tolerance: float


@dataclass(frozen=True)
class StudySettings:
    """Sizing and pass marks for the two seed-averaged comparison studies."""

    seeds: int
    scenarios: int
    matched_target_monthly: float
    elliptical_weight_tolerance: float
    divergence_ratio_min: float


@dataclass(frozen=True)
class Tolerances:
    """Numerical slack allowed by each independent check of a solution."""

    constraint_abs: float
    cvar_agreement_abs: float
    var_recovery_abs: float
    solver_agreement_rel: float
    relaxation_abs: float
    dual_relative: float


@dataclass(frozen=True)
class Scenario:
    """One complete, validated run configuration."""

    universe: Universe
    limits: DeskLimits
    market: GeneratorSettings
    frontier: FrontierSettings
    algorithms: AlgorithmSettings
    studies: StudySettings
    tolerances: Tolerances
    cvar_beta: float
    headline_target_monthly: float
    returns_csv: Path | None


@dataclass(frozen=True)
class MarketScenarios:
    """A `[S, N]` matrix of one-month simple returns and its provenance."""

    returns: FloatArray
    mode: str
    seed: int
    digest: str


@dataclass(frozen=True)
class PortfolioSolution:
    """The variables read back out of one solved problem.

    `long_leg` and `short_leg` are the two nonnegative halves of `weights`,
    `turnover_leg` bounds `|weights - start_book|`, and `var_auxiliary` is
    the free scalar of the Rockafellar-Uryasev reformulation, which equals
    the empirical VaR at an optimum.
    """

    weights: FloatArray
    long_leg: FloatArray
    short_leg: FloatArray
    turnover_leg: FloatArray
    var_auxiliary: float
    objective: float


@dataclass(frozen=True)
class SolveOutcome:
    """One solve attempt, with the solver's status reported verbatim."""

    status: str
    solution: PortfolioSolution | None
    solver_name: str
    solve_seconds: float
    iterations: int | None
    duals: Mapping[str, float]


@dataclass(frozen=True)
class TailStatistics:
    """Empirical VaR and CVaR of a loss sample, in loss units."""

    var: float
    cvar: float
    tail_count: int


@dataclass(frozen=True)
class FrontierPoint:
    """Both models solved at one return target, plus the cross-evaluation."""

    target_monthly: float
    cvar_outcome: SolveOutcome
    variance_outcome: SolveOutcome
    cvar_of_variance_portfolio: float | None


@dataclass(frozen=True)
class LadderRow:
    """One row of the scenario-count by algorithm timing table."""

    scenarios: int
    solver_name: str
    status: str
    objective: float | None
    solve_seconds: float
    iterations: int | None


@dataclass(frozen=True)
class DualRow:
    """One shadow price, with its activity test and finite-difference check."""

    label: str
    active: bool
    dual_value: float
    finite_difference: float | None
    agrees: bool


@dataclass(frozen=True)
class VerificationReport:
    """Every reported number, recomputed from the weights alone.

    `checks` keeps the (name, passed) pairs in report order so a successful
    verification still records what was tested.

    `threshold_count` is the one field nothing asserts on. It counts the
    scenarios whose loss sits on the value-at-risk threshold, which is what
    decides how wide the set of optimal `var_auxiliary` values is — see
    `verification_exposures.var_interval`. A reader who edits the scenario
    can move it freely, so it is reported and never checked.
    """

    gross_leverage: float
    net_exposure: float
    portfolio_beta: float
    turnover: float
    name_gross_max: float
    sector_net: FloatArray
    sector_gross: FloatArray
    expected_gross_return: float
    borrow_cost: float
    trading_cost: float
    expected_net_return: float
    in_sample: TailStatistics
    out_of_sample: TailStatistics
    model_objective: float
    atom_oracle_cvar: float
    empirical_cvar: float
    var_recovery_gap: float
    threshold_count: int
    relaxation_max_overlap: float
    checks: tuple[tuple[str, bool], ...]
