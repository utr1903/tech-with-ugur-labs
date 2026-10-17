"""The bake-off: one linear program, three algorithms, several sample sizes.

The lab makes a claim a reader is entitled to be sceptical about — that
the hand-written Rockafellar-Uryasev reformulation has one right answer,
and that the answer is not an artifact of whichever solver happened to be
installed. The only honest way to support that is to run the same program
through genuinely different methods and show the objectives land on top of
each other.

Three algorithms, and the second and third are the interesting pair:

* **Clarabel** is an interior-point method. It walks through the middle of
  the feasible region and stops near the optimal vertex, so its answers are
  right to about ten decimals and never to the last bit.
* **HiGHS simplex** walks the edges and finishes exactly on a vertex.
* **HiGHS interior point** is the control for the second: same library,
  same problem, a different method chosen only by an option string. If a
  future release quietly stopped honouring that option the lab would be
  running one algorithm twice and calling it a bake-off, so the iteration
  counts are recorded — hundreds of cheap pivots against tens of expensive
  Newton steps is the evidence, and `solver_test.py` asserts the gap.

The ladder runs each of those at several scenario counts because that is
the axis the cost actually lives on. Thirty names is a small problem; ten
thousand scenarios is a large one, since every scenario adds a row and a
variable to the tail-shortfall block.

**Each rung compiles its own problem.** The scenario matrix changes shape
between rungs, so the `cp.Parameter` trick that lets `frontier.py` reuse
one compilation cannot apply here. CVXPY's own `compilation_time` is
logged per rung so the build cost is visible separately from the solve
wall clock that `LadderRow` carries.

**Disagreement fails the run.** When two algorithms return objectives
further apart than `algorithms.objective_relative_tolerance`, this module
raises rather than picking a favourite. A lab that quietly reports the
first answer it got would be hiding exactly the thing it was built to
test.

This file runs a little past the ~200-line target the lab holds its
modules to, and the reason is prose rather than code: about 105 lines are
executable and the rest is the argument above. Splitting it would put the
two disagreement gates in a different file from the rung that runs them,
and the gates are the point of the rung.
"""

from __future__ import annotations

import cvxpy as cp

from app.contracts import LadderRow, MarketScenarios, Scenario, SolveOutcome
from app.errors import SolveError
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.model import build_cvar_problem
from app.solver import ALGORITHMS, solve_problem


def _compilation_seconds(problem: cp.Problem) -> float | None:
    """Return CVXPY's own record of how long canonicalizing this took.

    Set on the first solve rather than at construction, so it is read after
    a rung has run. `None` if this CVXPY never filled it in.
    """
    elapsed = problem.compilation_time
    if elapsed is None:
        return None
    return float(elapsed)


def _priced(rows: list[LadderRow]) -> list[LadderRow]:
    """Return the rows that came back with an objective value."""
    return [row for row in rows if row.objective is not None]


def _require_one_verdict(rows: list[LadderRow]) -> None:
    """Refuse a rung where the algorithms disagree about feasibility.

    Two solvers handed the identical program must agree on whether it can
    be satisfied at all. One saying `optimal` while another says
    `infeasible` is a larger disagreement than any objective gap, and
    reporting the optimistic one would be the worst available answer.

    Raises:
        SolveError: Naming the two solvers and their statuses.
    """
    priced = _priced(rows)
    if not priced or len(priced) == len(rows):
        return
    unpriced = next(row for row in rows if row.objective is None)
    raise SolveError(
        f"the algorithms disagree about whether the program can be solved at "
        f"{rows[0].scenarios} scenarios: {priced[0].solver_name} reported "
        f"{priced[0].status!r} and {unpriced.solver_name} reported "
        f"{unpriced.status!r}"
    )


def _require_agreement(rows: list[LadderRow], *, tolerance: float) -> None:
    """Refuse a rung whose objectives spread wider than the tolerance allows.

    The comparison is relative rather than absolute, and deliberately so.
    An interior-point method stops near the optimal vertex rather than on
    it, so an absolute ceiling tight enough to be interesting for the
    simplex answer would fail a Clarabel solve that is entirely correct. A
    genuine model disagreement — a sign error, a wrong tail count, a
    constraint attached to the wrong problem — moves an objective by
    percent, not by parts per billion.

    Raises:
        SolveError: Naming both solvers and both objectives.
    """
    priced = _priced(rows)
    if len(priced) < 2:
        return

    def objective_of(row: LadderRow) -> float:
        return 0.0 if row.objective is None else row.objective

    lowest = min(priced, key=objective_of)
    highest = max(priced, key=objective_of)
    spread = objective_of(highest) - objective_of(lowest)
    scale = max(abs(objective_of(highest)), abs(objective_of(lowest)))
    if spread > tolerance * scale:
        raise SolveError(
            f"the algorithms disagree at {rows[0].scenarios} scenarios: "
            f"{lowest.solver_name} returned {objective_of(lowest):.12g} and "
            f"{highest.solver_name} returned {objective_of(highest):.12g}, a "
            f"relative spread of {spread / scale:.3g} against a tolerance of "
            f"{tolerance:g}"
        )


def _row(outcome: SolveOutcome, *, scenarios: int) -> LadderRow:
    """Flatten one solve into the ladder's row shape."""
    return LadderRow(
        scenarios=scenarios,
        solver_name=outcome.solver_name,
        status=outcome.status,
        objective=None if outcome.solution is None else outcome.solution.objective,
        solve_seconds=outcome.solve_seconds,
        iterations=outcome.iterations,
    )


def _rung(scenario: Scenario, count: int, *, log: Logger) -> list[LadderRow]:
    """Draw a matrix at one scenario count and solve it under every algorithm.

    The draw uses the scenario's own seed, so a rung is reproducible and
    two runs of the ladder compare the same matrices.
    """
    market: MarketScenarios = generate_scenarios(
        scenario.universe,
        scenario.market,
        seed=scenario.market.seed,
        count=count,
        mode=scenario.market.mode,
        log=log,
    )
    built = build_cvar_problem(scenario, market, log=log)
    rows = [
        _row(
            solve_problem(
                built,
                algorithm=algorithm,
                target=scenario.headline_target_monthly,
                log=log,
            ),
            scenarios=count,
        )
        for algorithm in ALGORITHMS
    ]
    _require_one_verdict(rows)
    _require_agreement(rows, tolerance=scenario.algorithms.objective_relative_tolerance)
    log.info(
        "Climbed one ladder rung.",
        scenarios=count,
        compilation_seconds=_compilation_seconds(built.problem),
        statuses=sorted({row.status for row in rows}),
    )
    return rows


def run_algorithm_ladder(scenario: Scenario, *, log: Logger) -> tuple[LadderRow, ...]:
    """Solve the CVaR program at every ladder rung under every algorithm.

    Args:
        scenario: The mandate, the headline target, the ladder's scenario
            counts and the agreement tolerance.
        log: Logger for the operation boundary.

    Returns:
        One row per (scenario count, algorithm) pair, rungs in the order
        the scenario lists them and algorithms in table order.

    Raises:
        SolveError: If two algorithms disagree about the objective by more
            than `algorithms.objective_relative_tolerance`, or disagree
            about whether the program can be satisfied at all.
        MarketError: If a rung's scenario count is not positive.
    """
    ladder = scenario.algorithms.scenario_ladder
    ladder_log = log.bind(rungs=len(ladder), algorithms=len(ALGORITHMS))
    try:
        ladder_log.info(
            "Running the algorithm ladder...",
            scenario_counts=list(ladder),
            target=scenario.headline_target_monthly,
            tolerance=scenario.algorithms.objective_relative_tolerance,
        )
        rows = tuple(row for count in ladder for row in _rung(scenario, count, log=log))
    except Exception:
        ladder_log.exception("Running the algorithm ladder failed.")
        raise
    else:
        ladder_log.info(
            "Running the algorithm ladder succeeded.",
            rows=len(rows),
            total_solve_seconds=round(sum(row.solve_seconds for row in rows), 6),
        )
        return rows
