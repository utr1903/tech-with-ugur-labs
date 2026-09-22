"""Trace both books across the whole range of return targets the desk can ask for.

A single portfolio is an anecdote. The frontier is the argument: hold the
mandate fixed, walk the required return from the bottom of the range to the
top, and watch what the tail costs at each step. Two books are traced at
every point — the Rockafellar-Uryasev CVaR book and the mean-variance
control — and both are then scored on the *same* ruler, the empirical CVaR
of the returns matrix, so the chart compares two answers to one question
rather than two questions.

**Compile once, solve many.** The return target is a `cp.Parameter`, the
problem is DPP-compliant, and the two programs are therefore built exactly
once here and re-solved at every point on the grid by assigning
`built.target.value`. Rebuilding the CVaR program per point would
re-canonicalize ten thousand tail-shortfall rows twenty-five times over for
no gain. The entry log records the compile-once fact so a reader watching
the JSON sees one build followed by many solves.

**An unreachable target is a result, not a crash.** Past some point the
mandate cannot deliver the required return at any risk, and the solver says
`infeasible`. That status is recorded verbatim and the point carries no
weights. At the shipped 10,000 scenarios 22 of the 25 targets are feasible
and the last 3 are not; at the 600 scenarios the tests run on, all 25 are
feasible, because a smaller sample's mean is more optimistic. Both counts
move with the sample.

**The signed split is reported here, never asserted.** `verify_solution`
would refuse the bottom of this sweep, and it would be right to: where the
return target is slack, nothing in the program penalises holding a name
long and short at once, so the optimal face widens and an interior-point
solver settles inside it. Measured, the split is padded on 12 of the 25
targets at 600 scenarios and on 9 of the 25 at 10,000. That is a property
of the model worth putting on the chart, so `point_relaxation_overlap`
exposes it per point and the sweep logs it; the hard `relaxation_exact`
check stays where it belongs, on the single headline portfolio.

This file runs a little past the ~200-line target the lab holds its
modules to, and the reason is prose rather than code: about 113 lines are
executable and the rest is the three arguments above. Splitting it would
separate the compile-once rule from the loop that depends on it.
"""

from __future__ import annotations

import numpy as np

from app.contracts import (
    FloatArray,
    FrontierPoint,
    FrontierSettings,
    MarketScenarios,
    Scenario,
    SolveOutcome,
)
from app.logging_setup import Logger
from app.model import BuiltProblem, build_cvar_problem, build_variance_problem
from app.solver import solve_problem
from app.tailrisk import portfolio_losses, tail_statistics
from app.verification import relaxation_overlap

# Clarabel traces the sweep, because the sweep is fifty solves and it is
# the cheap one: on the ladder's 8,000-scenario rung it solves this program
# in 0.31 s against HiGHS's 1.28 for simplex and 1.13 for its
# interior-point method. Those three are wall clock on one laptop and will
# not reproduce to the digit anywhere else; the ordering is the durable
# part. Cross-algorithm agreement is the ladder's job, in `algorithms.py`,
# where it is the point rather than an overhead.
SWEEP_ALGORITHM = "CLARABEL"


def target_grid(settings: FrontierSettings) -> FloatArray:
    """Return the ascending grid of monthly return targets to sweep.

    Args:
        settings: The number of points and the two ends of the range.

    Returns:
        A length-`points` ascending array, endpoints included.
    """
    grid: FloatArray = np.linspace(
        settings.min_target_monthly, settings.max_target_monthly, settings.points
    )
    return grid


def point_relaxation_overlap(point: FrontierPoint) -> float | None:
    """Return how far the signed split lapsed at one frontier point.

    `max_i min(l_i, s_i)`, the largest amount any single name is held long
    and short at once in the CVaR book. Zero means the legs describe the
    same portfolio the weights do; a number of the order of 1e-02 means
    they do not, and every quantity the model charges against the legs —
    borrow, gross leverage — is overstated there.

    `None` where the point produced no weights. Nothing asserts on this
    value; see the module docstring for why the sweep reports it instead.
    """
    solution = point.cvar_outcome.solution
    if solution is None:
        return None
    return relaxation_overlap(solution.long_leg, solution.short_leg)


def _cvar_of(
    outcome: SolveOutcome, market: MarketScenarios, beta: float
) -> float | None:
    """Score a solved book's tail on the empirical CVaR of the sample.

    This is how the mean-variance portfolio is put on the CVaR model's own
    axis. It is deliberately *not* a call to `verify_solution`: that pass
    checks claims specific to the Rockafellar-Uryasev program — that the
    objective is a tail average, that the auxiliary scalar recovers the
    value at risk — and a variance book satisfies neither.

    What actually happens if a variance solve is handed to the verifier is
    blunter than that, and worth recording rather than inferring. The
    variance program has no `var_auxiliary` variable at all, so the
    extracted solution carries `nan` in that field and the very first
    check, `weights_finite`, raises: `weights_finite failed: 0 non-finite
    of 30 weights, auxiliary scalar nan`. Measured at both 600 and 10,000
    scenarios at the 0.005 matched target. The refusal is real but it
    never reaches the objective comparison, so nothing about that comparison
    can be read off it — which is exactly why the scoring here is a
    NumPy tail average and not a verification pass.
    """
    if outcome.solution is None:
        return None
    losses = portfolio_losses(market.returns, outcome.solution.weights)
    return tail_statistics(losses, beta).cvar


def _trace_point(
    cvar_built: BuiltProblem,
    variance_built: BuiltProblem,
    market: MarketScenarios,
    *,
    target: float,
    beta: float,
    log: Logger,
) -> FrontierPoint:
    """Solve both programs at one target and record what came back."""
    cvar_outcome = solve_problem(
        cvar_built, algorithm=SWEEP_ALGORITHM, target=target, log=log
    )
    variance_outcome = solve_problem(
        variance_built, algorithm=SWEEP_ALGORITHM, target=target, log=log
    )
    point = FrontierPoint(
        target_monthly=target,
        cvar_outcome=cvar_outcome,
        variance_outcome=variance_outcome,
        cvar_of_variance_portfolio=_cvar_of(variance_outcome, market, beta),
    )
    solution = cvar_outcome.solution
    log.info(
        "Traced one frontier point.",
        target=target,
        cvar_status=cvar_outcome.status,
        variance_status=variance_outcome.status,
        cvar_objective=None if solution is None else solution.objective,
        cvar_of_variance_portfolio=point.cvar_of_variance_portfolio,
        split_overlap=point_relaxation_overlap(point),
    )
    return point


def sweep_frontier(
    scenario: Scenario, market: MarketScenarios, *, log: Logger
) -> tuple[FrontierPoint, ...]:
    """Trace the CVaR book and the variance book across the target grid.

    Args:
        scenario: The universe, the mandate, `cvar_beta` and the grid.
        market: The `[S, N]` matrix both books are chosen on and scored on.
        log: Logger for the operation boundary.

    Returns:
        One `FrontierPoint` per target, in ascending target order. A point
        whose solver reported an unreachable target carries that status
        verbatim and no weights.

    Raises:
        ModelError: If the return matrix does not fit the universe.
        SolveError: If a solver failed outright, as opposed to reporting a
            problem it could not satisfy.
    """
    grid = target_grid(scenario.frontier)
    sweep_log = log.bind(
        points=int(grid.size),
        scenarios=int(market.returns.shape[0]),
        algorithm=SWEEP_ALGORITHM,
    )
    try:
        sweep_log.info(
            "Sweeping the frontier...",
            min_target=scenario.frontier.min_target_monthly,
            max_target=scenario.frontier.max_target_monthly,
            builds=2,
            solves=int(grid.size) * 2,
        )
        cvar_built = build_cvar_problem(scenario, market, log=log)
        variance_built = build_variance_problem(scenario, market, log=log)
        points = tuple(
            _trace_point(
                cvar_built,
                variance_built,
                market,
                target=float(target),
                beta=scenario.cvar_beta,
                log=log,
            )
            for target in grid
        )
    except Exception:
        sweep_log.exception("Sweeping the frontier failed.")
        raise
    else:
        overlaps = [point_relaxation_overlap(point) for point in points]
        sweep_log.info(
            "Sweeping the frontier succeeded.",
            feasible=sum(
                1 for point in points if point.cvar_outcome.solution is not None
            ),
            infeasible=sum(
                1 for point in points if point.cvar_outcome.solution is None
            ),
            worst_split_overlap=max(
                (value for value in overlaps if value is not None), default=None
            ),
        )
        return points
