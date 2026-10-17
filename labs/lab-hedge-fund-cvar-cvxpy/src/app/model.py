"""The three programs this lab compares, written out by hand.

**The CVaR linear program.** Minimizing the average loss of the worst
`1 - beta` share of scenarios looks like it needs sorting, and sorting is
not something a solver can differentiate. Rockafellar and Uryasev's
reformulation removes the sort. Introduce a free scalar `a` and one
nonnegative slack `u_s` per scenario, require

    u_s >= loss_s(w) - a      and      u_s >= 0

and minimize

    a + sum(u) / ((1 - beta) * S).

At the optimum each `u_s` collapses to `max(loss_s(w) - a, 0)`, the
objective becomes the CVaR, and `a` settles on the value at risk. Every
line of that is affine in `(w, a, u)`, so with the affine desk mandate in
`model_desk.py` the whole thing is a linear program — which is why a
simplex method can solve it at 10,000 scenarios in well under a second.

**The mean-variance control.** The same feasible set, the same return
target, a quadratic objective: `w' Sigma w`. It is the textbook answer, and
comparing the two books it produces against the CVaR book is the point of
the lab. Whatever they disagree about is caused by the shape of the loss
distribution beyond its first two moments, because nothing else differs.

**The atom oracle.** CVXPY can express the tail average directly, as
`sum_largest(losses, k) / k`. Solving that over the identical constraints
is an independent path to the same number: it shares no line of algebra
with the reformulation above, so agreement between them is evidence the
hand derivation is right rather than evidence it is self-consistent.

The three builders live in one file on purpose. They are read side by side
— the whole argument of the lab is that only their objective differs — and
the shared half they all stand on has already been lifted out into
`model_desk.py`, with the build-time logging in `model_logging.py`. What is
left is three short functions and the contract they return.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import cvxpy as cp

from app.contracts import MarketScenarios, Scenario
from app.cvxpy_api import is_dpp
from app.errors import ModelError
from app.logging_setup import Logger
from app.model_desk import (
    DeskBlock,
    desk_block,
    require_usable_returns,
    sample_covariance,
    variable_list,
)
from app.model_logging import log_constraint_families, log_variables
from app.tailrisk import tail_count

CVAR_KIND = "cvar"
VARIANCE_KIND = "variance"
ATOM_KIND = "atom"

# How far `(1 - beta) * S` may sit from a whole number before the atom
# oracle refuses to build. Its equality with the linear program above is
# exact only at an integer tail count; away from one the two objectives
# answer slightly different questions and comparing them proves nothing.
INTEGER_TAIL_TOLERANCE = 1e-9


@dataclass(frozen=True, eq=False)
class BuiltProblem:
    """A compiled problem and every handle a caller needs afterwards.

    `var_auxiliary` is the Rockafellar-Uryasev scalar and exists only for
    the linear program; the variance and atom models reach the same
    feasible set without one. `labelled` names the constraints whose duals
    the lab reports, and `kind` records which of the three this is so a
    report can say what produced a number.

    `eq=False` because `==` on a CVXPY expression builds a constraint
    rather than answering a question, so a generated `__eq__` would
    silently do something other than compare. Identity is the only
    equality this ever needs.
    """

    problem: cp.Problem
    weights: cp.Variable
    long_leg: cp.Variable
    short_leg: cp.Variable
    turnover_leg: cp.Variable
    var_auxiliary: cp.Variable | None
    target: cp.Parameter
    labelled: Mapping[str, cp.Constraint]
    kind: str


def _assemble(
    block: DeskBlock,
    *,
    kind: str,
    objective: cp.Minimize,
    var_auxiliary: cp.Variable | None,
) -> BuiltProblem:
    """Pair one objective with the shared desk block."""
    return BuiltProblem(
        problem=cp.Problem(objective, list(block.families.values())),
        weights=block.variables.weights,
        long_leg=block.variables.long_leg,
        short_leg=block.variables.short_leg,
        turnover_leg=block.variables.turnover_leg,
        var_auxiliary=var_auxiliary,
        target=block.target,
        labelled=block.labelled,
        kind=kind,
    )


def _log_model(
    block: DeskBlock,
    *,
    kind: str,
    extra: list[cp.Variable],
    log: Logger,
) -> None:
    """Log every variable and every constraint family of a built model."""
    log_variables([*variable_list(block.variables), *extra], kind=kind, log=log)
    log_constraint_families(block.families, kind=kind, log=log)


def build_cvar_problem(
    scenario: Scenario, market: MarketScenarios, *, log: Logger
) -> BuiltProblem:
    """Build the Rockafellar-Uryasev linear program for this scenario.

    Args:
        scenario: The universe, the desk mandate and `cvar_beta`.
        market: The `[S, N]` return matrix the tail is measured on.
        log: Logger for the operation boundary.

    Returns:
        The built problem, its variables and its dual-bearing constraints.

    Raises:
        ModelError: If the return matrix does not fit the universe.
    """
    returns = require_usable_returns(scenario, market.returns)
    scenario_count, name_count = returns.shape
    beta = scenario.cvar_beta

    build_log = log.bind(
        kind=CVAR_KIND, scenarios=scenario_count, names=name_count, beta=beta
    )
    try:
        build_log.info("Building the CVaR program...")
        block = desk_block(scenario, returns)
        var_auxiliary = cp.Variable(name="var_auxiliary")
        shortfall = cp.Variable(scenario_count, name="tail_shortfall", nonneg=True)
        # The one row per scenario that replaces the sort. Together with
        # `shortfall >= 0` on the variable itself this pins each slack to
        # `max(loss - a, 0)` at the optimum.
        block.families["tail_shortfall"] = (
            shortfall >= -(returns @ block.variables.weights) - var_auxiliary
        )
        # `(1 - beta) * S` is the Rockafellar-Uryasev denominator, the
        # expected number of scenarios in the tail. No ceiling is taken
        # here, so this is not the tail count and the rounding hazard that
        # `tailrisk.tail_count` exists to avoid does not arise; a count is
        # only ever needed when scenarios have to be selected, as in the
        # atom oracle below.
        objective = cp.Minimize(
            var_auxiliary + cp.sum(shortfall) / ((1.0 - beta) * scenario_count)
        )
        built = _assemble(
            block, kind=CVAR_KIND, objective=objective, var_auxiliary=var_auxiliary
        )
    except Exception:
        build_log.exception("Building the CVaR program failed.")
        raise
    else:
        _log_model(block, kind=CVAR_KIND, extra=[var_auxiliary, shortfall], log=log)
        build_log.info(
            "Building the CVaR program succeeded.",
            constraints=len(built.problem.constraints),
            is_dpp=is_dpp(built.problem),
        )
        return built


def build_variance_problem(
    scenario: Scenario, market: MarketScenarios, *, log: Logger
) -> BuiltProblem:
    """Build the mean-variance control over the identical constraints.

    Raises:
        ModelError: If the return matrix does not fit the universe.
    """
    returns = require_usable_returns(scenario, market.returns)
    scenario_count, name_count = returns.shape

    build_log = log.bind(kind=VARIANCE_KIND, scenarios=scenario_count, names=name_count)
    try:
        build_log.info("Building the variance program...")
        block = desk_block(scenario, returns)
        # `psd_wrap` is a promise, not a repair: with fewer scenarios than
        # names the sample covariance is rank-deficient and its smallest
        # eigenvalues come out as tiny negative numbers, which CVXPY's own
        # positive-semidefinite test refuses. Wrapping asserts the matrix
        # is PSD by construction — which a covariance matrix is — so the
        # problem stays DCP instead of failing on arithmetic noise.
        objective = cp.Minimize(
            cp.quad_form(
                block.variables.weights, cp.psd_wrap(sample_covariance(returns))
            )
        )
        built = _assemble(
            block, kind=VARIANCE_KIND, objective=objective, var_auxiliary=None
        )
    except Exception:
        build_log.exception("Building the variance program failed.")
        raise
    else:
        _log_model(block, kind=VARIANCE_KIND, extra=[], log=log)
        build_log.info(
            "Building the variance program succeeded.",
            constraints=len(built.problem.constraints),
            is_dpp=is_dpp(built.problem),
        )
        return built


def build_atom_oracle_problem(
    scenario: Scenario, market: MarketScenarios, *, log: Logger
) -> BuiltProblem:
    """Build the same portfolio choice using CVXPY's own tail-average atom.

    Raises:
        ModelError: If the return matrix does not fit the universe, or if
            `(1 - beta) * S` is not a whole number — the oracle's equality
            with the linear program holds only there.
    """
    returns = require_usable_returns(scenario, market.returns)
    scenario_count, name_count = returns.shape
    beta = scenario.cvar_beta
    in_tail = tail_count(scenario_count, beta)
    share = (1.0 - beta) * scenario_count
    if abs(share - in_tail) > INTEGER_TAIL_TOLERANCE:
        raise ModelError(
            f"the atom oracle needs (1 - cvar_beta) * scenarios to be a whole "
            f"number; at beta {beta} and {scenario_count} scenarios it is {share}"
        )

    build_log = log.bind(
        kind=ATOM_KIND,
        scenarios=scenario_count,
        names=name_count,
        beta=beta,
        tail_count=in_tail,
    )
    try:
        build_log.info("Building the atom oracle...")
        block = desk_block(scenario, returns)
        losses = -(returns @ block.variables.weights)
        objective = cp.Minimize(cp.sum_largest(losses, in_tail) / in_tail)
        built = _assemble(
            block, kind=ATOM_KIND, objective=objective, var_auxiliary=None
        )
    except Exception:
        build_log.exception("Building the atom oracle failed.")
        raise
    else:
        _log_model(block, kind=ATOM_KIND, extra=[], log=log)
        build_log.info(
            "Building the atom oracle succeeded.",
            constraints=len(built.problem.constraints),
            is_dpp=is_dpp(built.problem),
        )
        return built
