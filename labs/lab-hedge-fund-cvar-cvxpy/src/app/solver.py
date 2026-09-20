"""Run one built problem under a named algorithm and report what came back.

The lab solves the same linear program three ways, and the three are not
window dressing. Clarabel is an interior-point method: it walks through the
middle of the feasible region and stops near the optimal vertex rather than
on it, which is why its answers are correct to about ten decimals and never
to the last bit. HiGHS's simplex method walks the edges and finishes
*exactly* on a vertex. HiGHS's own interior-point method is the third, and
it is the control for the second — same library, same problem, a different
algorithm, so anything the two disagree about is the method rather than the
implementation.

Two rules run through this module.

**A status is reported, never relabelled.** `optimal_inaccurate` means the
solver hit its tolerance limits without converging to its own satisfaction.
The outcome still carries the weights, because a portfolio manager would
rather see a nearly-converged book and know it is nearly converged; what it
never does is come back saying `optimal`.

**An outcome that carries no solution carries no duals.** CVXPY leaves dual
values attached to the constraint objects after a solve, including the
Farkas certificate of an infeasible one. Those numbers are real, but they
are not shadow prices of a portfolio, and reading them would put
meaningless figures in a table headed "what this constraint costs you".

This file runs past the ~200-line target the lab holds its modules to, and
the reason is the prose rather than the code: about 90 lines are executable
and the rest is the explanation above and the docstrings below. Splitting
it would put the algorithm table, the status rule and the extraction that
depends on both into separate files, and a reader would have to hold all
three open to follow one solve.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass

import cvxpy as cp
import numpy as np

from app.contracts import (
    FloatArray,
    PortfolioSolution,
    SolveOutcome,
    frozen_float_array,
)
from app.cvxpy_api import solve
from app.errors import SolveError
from app.logging_setup import Logger
from app.model import BuiltProblem


@dataclass(frozen=True)
class SolverChoice:
    """One algorithm: the CVXPY solver name and the options that pick it."""

    solver: str
    options: Mapping[str, object]


# `solver="simplex"` and `solver="ipm"` are HiGHS's own option values, not
# CVXPY's, and they travel to HiGHS through CVXPY's `highs_options`
# passthrough dictionary. That indirection is the load-bearing detail of
# this table: both HiGHS rows name the same CVXPY solver, so without the
# option the lab would be running one algorithm twice and calling it a
# bake-off. The iteration counts are the evidence that it is not — a
# simplex run takes hundreds of cheap pivots where an interior-point run
# takes tens of expensive Newton steps, and `solver_test.py` asserts the
# gap rather than trusting the option to have been honoured.
ALGORITHMS: Mapping[str, SolverChoice] = {
    "CLARABEL": SolverChoice(solver=cp.CLARABEL, options={}),
    "HIGHS_SIMPLEX": SolverChoice(
        solver=cp.HIGHS, options={"highs_options": {"solver": "simplex"}}
    ),
    "HIGHS_IPM": SolverChoice(
        solver=cp.HIGHS, options={"highs_options": {"solver": "ipm"}}
    ),
}

# The two statuses that come with usable variable values. The second is
# reported exactly as it arrives; see the module docstring.
SOLUTION_STATUSES = (cp.OPTIMAL, cp.OPTIMAL_INACCURATE)


def _vector(variable: cp.Variable) -> FloatArray:
    """Read one solved vector back out of the problem.

    Raises:
        SolveError: If the solver reported a solution but left this
            variable empty, which would mean the problem and the status
            disagree about whether a solve happened.
    """
    value = variable.value
    if value is None:
        raise SolveError(f"the solver left no value on variable {variable.name()!r}")
    return frozen_float_array(np.asarray(value, dtype=np.float64))


def _auxiliary(variable: cp.Variable | None) -> float:
    """Read the Rockafellar-Uryasev scalar, or NaN if this model has none.

    The variance control and the atom oracle reach the same feasible set
    without an auxiliary scalar, so there is no value to report for them
    and no honest number to invent. NaN says exactly that, and it makes the
    VaR-recovery check in `verification.py` fail loudly rather than pass on
    a zero that would have looked plausible.
    """
    if variable is None:
        return float("nan")
    value = variable.value
    if value is None:
        raise SolveError("the solver left no value on the VaR auxiliary scalar")
    return float(value)


def _objective(problem: cp.Problem) -> float:
    """Read the objective value of a solved problem.

    Raises:
        SolveError: If the status says a solution exists and no value does.
    """
    value = problem.value
    if value is None:
        raise SolveError("the solver reported a solution with no objective value")
    return float(value)


def _solution(built: BuiltProblem) -> PortfolioSolution:
    """Copy every decision variable out of the solved problem."""
    return PortfolioSolution(
        weights=_vector(built.weights),
        long_leg=_vector(built.long_leg),
        short_leg=_vector(built.short_leg),
        turnover_leg=_vector(built.turnover_leg),
        var_auxiliary=_auxiliary(built.var_auxiliary),
        objective=_objective(built.problem),
    )


def _duals(built: BuiltProblem) -> Mapping[str, float]:
    """Read the shadow price of each dual-bearing constraint.

    A solver is allowed to return no duals at all — a presolve that removes
    a row, or a method that never forms the dual — so a missing value is
    skipped rather than faked. Every label that does arrive is a scalar
    here, because `model_desk.py` only labels scalar constraints.
    """
    duals: dict[str, float] = {}
    for label, constraint in built.labelled.items():
        value = constraint.dual_value
        if value is not None:
            duals[label] = float(value)
    return duals


def _iterations(problem: cp.Problem) -> int | None:
    """Return the solver's iteration count, or `None` if it reported none.

    HiGHS leaves this empty on an infeasible solve and Clarabel does not,
    so the field is genuinely optional rather than defensively typed.
    """
    stats = problem.solver_stats
    if stats is None or stats.num_iters is None:
        return None
    return int(stats.num_iters)


def solve_problem(
    built: BuiltProblem, *, algorithm: str, target: float, log: Logger
) -> SolveOutcome:
    """Solve one built problem at one return target under one algorithm.

    Setting `built.target` rather than rebuilding is what the DPP-compliant
    `cp.Parameter` in `model_desk.py` buys: the same compiled problem
    serves every point of the frontier sweep.

    Args:
        built: A compiled problem and its variable handles.
        algorithm: A key of `ALGORITHMS`.
        target: The expected net monthly return the book must deliver.
        log: Logger for the operation boundary.

    Returns:
        The status verbatim, the solution if one exists, the duals if a
        solution exists, the wall clock and the iteration count.

    Raises:
        SolveError: If `algorithm` is not a known name, or the solver
            itself failed rather than reporting an unsolvable problem.
    """
    choice = ALGORITHMS.get(algorithm)
    if choice is None:
        raise SolveError(
            f"unknown algorithm {algorithm!r}; this lab runs "
            f"{', '.join(sorted(ALGORITHMS))}"
        )

    solve_log = log.bind(algorithm=algorithm, kind=built.kind, target=target)
    try:
        solve_log.info("Solving the program...")
        built.target.value = target
        started = time.perf_counter()
        solve(built.problem, solver=choice.solver, **dict(choice.options))
        elapsed = time.perf_counter() - started
    except cp.error.SolverError as err:
        solve_log.exception("Solving the program failed.")
        raise SolveError(
            f"{algorithm} could not solve the {built.kind} program at target {target}"
        ) from err
    except Exception:
        solve_log.exception("Solving the program failed.")
        raise
    else:
        outcome = _outcome(built, algorithm=algorithm, seconds=elapsed)
        solve_log.info(
            "Solving the program succeeded.",
            status=outcome.status,
            objective=None if outcome.solution is None else outcome.solution.objective,
            seconds=round(outcome.solve_seconds, 6),
            iterations=outcome.iterations,
            duals=len(outcome.duals),
        )
        return outcome


def _outcome(built: BuiltProblem, *, algorithm: str, seconds: float) -> SolveOutcome:
    """Assemble the outcome, reading variables only where a solution exists."""
    status = str(built.problem.status)
    carries_solution = status in SOLUTION_STATUSES
    return SolveOutcome(
        status=status,
        solution=_solution(built) if carries_solution else None,
        solver_name=algorithm,
        solve_seconds=seconds,
        iterations=_iterations(built.problem),
        duals=_duals(built) if carries_solution else {},
    )
