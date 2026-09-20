"""Behaviour tests for the three-algorithm, several-sample-size bake-off.

The shipped ladder runs 500, 2,000 and 8,000 scenarios, which costs about
three seconds. These tests run a two-rung ladder instead, small enough to
stay interactive and still large enough for the simplex and interior-point
iteration counts to be unmistakably different.
"""

from __future__ import annotations

import itertools
from dataclasses import replace

import pytest

from app import algorithms
from app.contracts import LadderRow, Scenario, SolveOutcome
from app.errors import SolveError
from app.logging_setup import Logger
from app.model import BuiltProblem
from app.solver import ALGORITHMS, solve_problem

# Two rungs. The top one is 600 scenarios, the size every other solving
# test in this lab uses, where simplex takes 341 pivots against the
# interior-point method's 25.
TEST_LADDER = (300, 600)


@pytest.fixture(scope="session")
def ladder_scenario(small_scenario: Scenario) -> Scenario:
    """Return the shipped mandate with a cheap two-rung ladder."""
    return replace(
        small_scenario,
        algorithms=replace(small_scenario.algorithms, scenario_ladder=TEST_LADDER),
    )


@pytest.fixture(scope="session")
def ladder_rows(ladder_scenario: Scenario, log: Logger) -> tuple[LadderRow, ...]:
    """Run the two-rung ladder once for the whole file."""
    return algorithms.run_algorithm_ladder(ladder_scenario, log=log)


def test_the_ladder_covers_every_scenario_count_and_algorithm(
    ladder_scenario: Scenario, ladder_rows: tuple[LadderRow, ...]
) -> None:
    """Every rung is run under every algorithm, and every row is priced."""
    assert {(row.scenarios, row.solver_name) for row in ladder_rows} == set(
        itertools.product(ladder_scenario.algorithms.scenario_ladder, ALGORITHMS)
    )
    assert all(row.status == "optimal" for row in ladder_rows)
    assert all(row.objective is not None for row in ladder_rows)
    assert all(row.solve_seconds > 0.0 for row in ladder_rows)


def test_every_algorithm_on_a_rung_reaches_the_same_objective(
    ladder_scenario: Scenario, ladder_rows: tuple[LadderRow, ...]
) -> None:
    """The rungs pass their own agreement gate, so the spread is inside it.

    Restated here as an assertion on the returned table rather than on the
    absence of a raise, so a future change that loosened the gate to the
    point of meaninglessness would still be caught by a measured number.
    """
    tolerance = ladder_scenario.algorithms.objective_relative_tolerance
    for count in ladder_scenario.algorithms.scenario_ladder:
        values = [
            row.objective
            for row in ladder_rows
            if row.scenarios == count and row.objective is not None
        ]
        assert len(values) == len(ALGORITHMS)
        scale = max(abs(value) for value in values)
        assert max(values) - min(values) <= tolerance * scale


def test_simplex_and_interior_point_are_genuinely_different_algorithms(
    ladder_rows: tuple[LadderRow, ...],
) -> None:
    """Both HiGHS rows name one solver; only the option tells them apart.

    If a future release stopped honouring `highs_options={"solver": ...}`
    the ladder would be running one algorithm twice and reporting it as a
    bake-off. The iteration counts are the runtime evidence that it is
    not: a simplex run takes hundreds of cheap pivots where an
    interior-point run takes tens of expensive Newton steps. Measured on
    the 600-scenario rung, 341 against 25.
    """
    top = max(row.scenarios for row in ladder_rows)
    by_solver = {row.solver_name: row for row in ladder_rows if row.scenarios == top}
    simplex = by_solver["HIGHS_SIMPLEX"]
    interior = by_solver["HIGHS_IPM"]
    assert simplex.iterations is not None
    assert interior.iterations is not None
    assert simplex.iterations != interior.iterations
    assert simplex.iterations > 4 * interior.iterations


def test_the_ladder_fails_the_run_when_algorithms_disagree(
    ladder_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One solver a percent away from the others stops the run.

    A lab that quietly reported whichever answer arrived first would be
    hiding exactly the disagreement it was built to surface, so the error
    names both solvers and both objectives and picks no favourite.
    """
    real_solve = solve_problem

    def skewed(
        built: BuiltProblem, *, algorithm: str, target: float, log: Logger
    ) -> SolveOutcome:
        outcome = real_solve(built, algorithm=algorithm, target=target, log=log)
        if algorithm != "HIGHS_SIMPLEX" or outcome.solution is None:
            return outcome
        drifted = replace(outcome.solution, objective=outcome.solution.objective * 1.01)
        return replace(outcome, solution=drifted)

    monkeypatch.setattr(algorithms, "solve_problem", skewed)

    with pytest.raises(SolveError, match="HIGHS_SIMPLEX"):
        algorithms.run_algorithm_ladder(ladder_scenario, log=log)


def test_a_rung_where_the_solvers_disagree_about_feasibility_fails(
    ladder_scenario: Scenario, log: Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One solver reporting no book at all is a bigger disagreement, not a smaller one.

    An objective gap is a numerical question; whether the mandate can be
    satisfied at all is not. Reporting the optimistic answer would be the
    worst outcome available, so this raises too.
    """
    real_solve = solve_problem

    def blinded(
        built: BuiltProblem, *, algorithm: str, target: float, log: Logger
    ) -> SolveOutcome:
        outcome = real_solve(built, algorithm=algorithm, target=target, log=log)
        if algorithm != "HIGHS_IPM":
            return outcome
        return replace(outcome, status="infeasible", solution=None, duals={})

    monkeypatch.setattr(algorithms, "solve_problem", blinded)

    with pytest.raises(SolveError, match="HIGHS_IPM"):
        algorithms.run_algorithm_ladder(ladder_scenario, log=log)


def test_each_rung_draws_its_own_matrix_and_compiles_its_own_problem(
    ladder_rows: tuple[LadderRow, ...],
) -> None:
    """A rung cannot reuse the compilation above it, because the shape changes.

    The tail-shortfall block carries one row and one variable per
    scenario, so 300 scenarios and 600 scenarios are different programs
    and the `cp.Parameter` trick the frontier sweep relies on does not
    apply. The observable consequence is that the two rungs reach
    different objectives at the same return target: the tail is estimated
    from different samples.
    """
    by_count = {
        count: next(
            row.objective
            for row in ladder_rows
            if row.scenarios == count and row.solver_name == "CLARABEL"
        )
        for count in sorted({row.scenarios for row in ladder_rows})
    }
    assert len(by_count) == len(TEST_LADDER)
    values = list(by_count.values())
    assert all(value is not None for value in values)
    assert values[0] != values[1]
