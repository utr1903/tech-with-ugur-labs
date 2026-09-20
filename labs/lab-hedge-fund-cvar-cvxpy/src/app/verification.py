"""The pass that is allowed to disbelieve the solver.

Everything above this module trusts CVXPY: the model is built out of CVXPY
expressions, the answer is read off CVXPY variables, and the objective is
whatever the solver said it was. This module trusts none of that. It takes
the weight vector and the scenario matrix, rebuilds every reported number
in NumPy, and refuses the solution if any of them disagrees with what the
mandate allows or with what the independent tail computations say.

That is why neither this file nor the two modules beside it ever imports
CVXPY — and why `verification_test.py` checks both that no import of it
appears in their source *and* that loading the verifier into a clean
interpreter leaves CVXPY unloaded. The shortcut those two guard against is
a real temptation: `model_desk.sample_mean` computes exactly the mean
vector the return check needs, and importing it would quietly make the
verification depend on the modelling layer it exists to audit.

**What this verifies.** A solution of the Rockafellar-Uryasev linear
program. Two of the thirteen checks — that the model objective is the
empirical CVaR, and that the auxiliary scalar recovers the value at risk —
are claims about that program in particular, so pointing this at a
mean-variance solution will correctly refuse it: a variance objective is
not a tail average, and a model carrying no auxiliary scalar reports NaN
for one.

**Which target is checked.** Whichever one the caller passes as `target`.
It is a required keyword argument rather than a field read off the
scenario, because the frontier sweep solves the same compiled problem at
twenty-five different targets and only one of them is the scenario's
headline. Checking a swept book against the headline would silently
compare it to a number nobody asked for — a wrong answer rather than an
error, which is the worst shape a defect can take in a verifier.

This file runs past the ~200-line target the lab holds its modules to, and
the reason is the prose rather than the code: roughly 120 lines are
executable and the rest is the argument above and the docstrings below.
The recomputation and the comparison vocabulary have already been lifted
out into `verification_exposures.py` and `verification_checks.py`; what is
left is one operation boundary and the report it assembles, and splitting
that would separate the raise from the checks it raises on.
"""

from __future__ import annotations

import numpy as np

from app.contracts import (
    FloatArray,
    MarketScenarios,
    PortfolioSolution,
    Scenario,
    SolveOutcome,
    VerificationReport,
)
from app.errors import VerificationError
from app.logging_setup import Logger
from app.tailrisk import portfolio_losses, tail_statistics
from app.verification_checks import (
    Check,
    first_failure,
    mandate_checks,
    model_checks,
    precondition_checks,
)
from app.verification_exposures import (
    cost_ledger,
    desk_exposures,
    interval_distance,
    threshold_count,
    var_interval,
)


def relaxation_overlap(long_leg: FloatArray, short_leg: FloatArray) -> float:
    """Return the largest amount any one name is held long and short at once.

    `model_desk.py` writes `w = l - s` with both legs nonnegative and
    nothing forbidding a name from carrying some of each. Where both are
    positive the split is padded: `l + s` overstates `|w|`, and everything
    the model charges against the legs — borrow, spread, gross leverage —
    is overstated with it. `min(l_i, s_i)` is exactly that padding on name
    `i`, and the worst name's padding is the number worth reporting; a mean
    over thirty names would hide one bad one.

    Zero means the split came back exact, so the weights, the legs and the
    costs all describe the same portfolio.
    """
    return float(np.minimum(long_leg, short_leg).max())


def _verify(
    scenario: Scenario,
    market: MarketScenarios,
    out_of_sample: MarketScenarios,
    solution: PortfolioSolution,
    oracle_cvar: float,
    target: float,
) -> tuple[VerificationReport, list[Check]]:
    """Recompute every reported number and every check from the weights."""
    weights = solution.weights
    universe, beta = scenario.universe, scenario.cvar_beta
    exposures = desk_exposures(universe, weights)
    ledger = cost_ledger(universe, market.returns, weights)
    losses = portfolio_losses(market.returns, weights)
    in_sample = tail_statistics(losses, beta)
    scored = tail_statistics(portfolio_losses(out_of_sample.returns, weights), beta)
    overlap = relaxation_overlap(solution.long_leg, solution.short_leg)
    var_gap = interval_distance(solution.var_auxiliary, var_interval(losses, beta))
    on_threshold = threshold_count(
        losses, beta, tolerance=scenario.tolerances.var_recovery_abs
    )

    checks = [
        *precondition_checks(weights=weights, auxiliary=solution.var_auxiliary),
        *mandate_checks(exposures, ledger, scenario, target=target),
        *model_checks(
            overlap=overlap,
            objective=solution.objective,
            in_sample=in_sample,
            oracle_cvar=oracle_cvar,
            var_gap=var_gap,
            tolerances=scenario.tolerances,
        ),
    ]
    report = VerificationReport(
        gross_leverage=exposures.gross_leverage,
        net_exposure=exposures.net_exposure,
        portfolio_beta=exposures.portfolio_beta,
        turnover=exposures.turnover,
        name_gross_max=exposures.name_gross_max,
        sector_net=exposures.sector_net,
        sector_gross=exposures.sector_gross,
        expected_gross_return=ledger.expected_gross_return,
        borrow_cost=ledger.borrow_cost,
        trading_cost=ledger.trading_cost,
        expected_net_return=ledger.expected_net_return,
        in_sample=in_sample,
        out_of_sample=scored,
        model_objective=solution.objective,
        atom_oracle_cvar=oracle_cvar,
        empirical_cvar=in_sample.cvar,
        var_recovery_gap=var_gap,
        threshold_count=on_threshold,
        relaxation_max_overlap=overlap,
        checks=tuple((check.name, check.passed) for check in checks),
    )
    return report, checks


def _require_all_passed(checks: list[Check], *, log: Logger) -> None:
    """Raise on the first failing check in report order.

    Report order is fixed in `verification_checks.py` and it matters. The
    finiteness precondition comes first, because every comparison behind it
    silently fails on a NaN and would misreport the cause. The desk limits
    come next, because a book that breaches its mandate is wrong for a
    reason a reader can act on. The tail agreements come last, since a
    disagreement there is usually a consequence of a fault already named
    above rather than a second, separate one.

    Raises:
        VerificationError: Naming the failing check and quoting the
            computed and permitted values.
    """
    failure = first_failure(checks)
    if failure is None:
        return
    log.error(
        "Verifying the solution failed.", check=failure.name, detail=failure.detail
    )
    raise VerificationError(f"{failure.name} failed: {failure.detail}")


def _log_success(report: VerificationReport, *, log: Logger) -> None:
    """Record the verified book, including the figures nothing asserts on.

    `threshold_count` is the one worth explaining. It is not a pass mark
    and never will be — a reader who edits the scenario can move it freely
    — but it is what decides how wide the optimal set of value-at-risk
    levels is, so it belongs in the record beside the recovery gap it
    explains, and in `solution.json` beside it too.
    """
    log.info(
        "Verifying the solution succeeded.",
        checks=len(report.checks),
        gross_leverage=round(report.gross_leverage, 6),
        net_exposure=round(report.net_exposure, 6),
        turnover=round(report.turnover, 6),
        expected_net_return=round(report.expected_net_return, 6),
        in_sample_cvar=round(report.in_sample.cvar, 6),
        out_of_sample_cvar=round(report.out_of_sample.cvar, 6),
        relaxation_max_overlap=report.relaxation_max_overlap,
        var_recovery_gap=report.var_recovery_gap,
        threshold_count=report.threshold_count,
    )


def verify_solution(
    scenario: Scenario,
    market: MarketScenarios,
    out_of_sample: MarketScenarios,
    outcome: SolveOutcome,
    oracle_cvar: float,
    *,
    target: float,
    log: Logger,
) -> VerificationReport:
    """Rebuild every reported number from the weights and refuse a bad book.

    Args:
        scenario: The universe, the desk mandate and the tolerances.
        market: The in-sample `[S, N]` matrix the book was chosen on.
        out_of_sample: A disjoint matrix the book is scored on afterwards.
        outcome: The solve to verify. It must carry a solution.
        oracle_cvar: The objective of the independent `sum_largest` solve,
            passed in rather than computed here so that this module never
            builds a CVXPY problem.
        target: The return target the book was solved at. Required, and
            deliberately not defaulted to the scenario's headline: a
            frontier point verified against the wrong target gets a
            verdict that means nothing and says nothing about it.
        log: Logger for the operation boundary.

    Returns:
        Every recomputed figure and the full ordered list of checks.

    Raises:
        VerificationError: If `outcome` carries no solution, or if any check
            fails. The message names the first failing check in report order.
    """
    if outcome.solution is None:
        raise VerificationError(
            f"cannot verify a solve that returned no weights; "
            f"{outcome.solver_name} reported status {outcome.status!r}"
        )

    solution = outcome.solution
    verify_log = log.bind(solver=outcome.solver_name, status=outcome.status)
    try:
        verify_log.info(
            "Verifying the solution...", names=solution.weights.size, target=target
        )
        report, checks = _verify(
            scenario, market, out_of_sample, solution, oracle_cvar, target
        )
    except Exception:
        verify_log.exception(
            "Verifying the solution failed.", names=solution.weights.size
        )
        raise
    else:
        _require_all_passed(checks, log=verify_log)
        _log_success(report, log=verify_log)
        return report
