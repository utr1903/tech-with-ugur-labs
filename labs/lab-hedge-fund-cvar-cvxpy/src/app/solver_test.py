"""Behaviour tests for the three algorithms the lab runs the model under.

The claim these defend is the one a reader is entitled to be sceptical
about: that the same linear program, handed to three different algorithms,
comes back with the same number. Every test here therefore solves, and
every solve runs on the small sample so the file stays interactive.
"""

from __future__ import annotations

import pytest

from app.contracts import MarketScenarios, Scenario
from app.errors import SolveError
from app.logging_setup import Logger
from app.model import build_cvar_problem
from app.solver import ALGORITHMS, solve_problem


def test_each_algorithm_reaches_the_same_objective(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """One program, three algorithms, one answer — within a stated tolerance.

    The tolerance is relative rather than absolute, and it is the
    scenario's own `solver_agreement_rel`. That matters: Clarabel is an
    interior-point method and stops at a point near the optimal vertex
    rather than on it, so an absolute ceiling tight enough to be
    interesting for the simplex answer would fail a Clarabel solve that is
    entirely correct. The measured spread on this fixture is 1.9e-12
    absolute and 1.5e-10 relative, and 6.4e-12 / 3.0e-10 at the shipped
    10,000 scenarios. The scenario allows 2.0e-7, which is ten times the
    worst relative spread measured anywhere in the lab — 2.0e-08, at
    10,000 scenarios on a seed two away from the shipped one — so this
    fixture sits about three decades inside it and the calibration still
    covers a draw far less lucky than this one.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcomes = {
        name: solve_problem(
            built,
            algorithm=name,
            target=small_scenario.headline_target_monthly,
            log=log,
        )
        for name in ALGORITHMS
    }

    assert all(outcome.status == "optimal" for outcome in outcomes.values())
    values = []
    for outcome in outcomes.values():
        assert outcome.solution is not None
        values.append(outcome.solution.objective)
    scale = max(abs(value) for value in values)
    spread = max(values) - min(values)
    assert spread <= small_scenario.tolerances.solver_agreement_rel * scale


def test_the_two_highs_algorithms_are_genuinely_different_algorithms(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """`highs_options={"solver": ...}` really does switch the method.

    Both HiGHS entries name the same CVXPY solver, so nothing about the
    call site says they differ. The iteration counts do: a simplex method
    takes hundreds of cheap pivots and an interior-point method takes tens
    of expensive Newton steps, and on this fixture the two come back at
    341 and 25 (3,525 and 42 at the shipped 10,000 scenarios). If a future
    CVXPY or HiGHS release ever stopped honouring
    the option, this is the test that would notice — the bake-off would
    quietly become the same algorithm run twice.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    simplex = solve_problem(built, algorithm="HIGHS_SIMPLEX", target=0.008, log=log)
    interior = solve_problem(built, algorithm="HIGHS_IPM", target=0.008, log=log)

    assert simplex.iterations is not None
    assert interior.iterations is not None
    assert simplex.iterations > 4 * interior.iterations


def test_status_is_reported_verbatim_and_no_solution_is_invented(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """An unreachable target produces a status, not a weight table.

    The duals are the subtle half. CVXPY leaves the previous solve's dual
    values — and on a fresh problem, an infeasibility certificate — hanging
    off the constraint objects, so reading them after a failed solve would
    report numbers that mean nothing about the portfolio. An outcome that
    carries no solution carries no duals either.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=1.0, log=log)

    assert outcome.status == "infeasible"
    assert outcome.solution is None
    assert outcome.duals == {}


def test_an_unknown_algorithm_name_is_rejected(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    built = build_cvar_problem(small_scenario, small_market, log=log)

    with pytest.raises(SolveError, match="HIGHS_PDLP"):
        solve_problem(built, algorithm="HIGHS_PDLP", target=0.0, log=log)


def test_duals_are_returned_for_every_labelled_constraint(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=0.008, log=log)

    assert set(outcome.duals) == {
        "return_target",
        "gross_leverage",
        "turnover_budget",
        "beta_upper",
        "beta_lower",
    }
    # The return target is the one that has to be paying for something at
    # this target: it is the constraint the whole mandate is bent around.
    assert outcome.duals["return_target"] > 0.0


def test_the_solve_is_timed_and_the_iteration_count_is_read_back(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The recorded wall clock has to bracket the solver's own measurement.

    `solve_seconds > 0` would be true of almost any bug, so it is not worth
    asserting. The falsifiable statement is that our timer spans the solve
    and a little more: it wraps the whole call, which is CVXPY's
    canonicalization on top of the solve the solver itself reports, so the
    solver's `solve_time` must fit inside it. A timer started in the wrong
    place, or one measuring a cached second call, breaks that.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=0.008, log=log)
    stats = built.problem.solver_stats

    assert outcome.solver_name == "CLARABEL"
    assert stats is not None
    assert stats.solve_time is not None
    assert 0.0 < stats.solve_time <= outcome.solve_seconds < 60.0
    assert outcome.iterations is not None
    assert outcome.iterations > 0


def test_one_compiled_problem_serves_two_targets(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Re-solving at a new target is a parameter change, not a rebuild.

    This is what the `cp.Parameter` return target buys, and it is the
    reason the frontier sweep is affordable. A higher demanded return over
    the same mandate cannot lower the minimum tail loss, so the objective
    has to rise.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    modest = solve_problem(built, algorithm="CLARABEL", target=0.004, log=log)
    demanding = solve_problem(built, algorithm="CLARABEL", target=0.008, log=log)

    assert modest.solution is not None
    assert demanding.solution is not None
    assert demanding.solution.objective > modest.solution.objective
