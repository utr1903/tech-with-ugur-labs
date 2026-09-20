"""Behaviour tests for the three programs the lab compares.

These tests solve. That is deliberate: a model is only as good as the
number that comes out of it, and the claims worth defending here — that
the hand-written reformulation really is a linear program, that it really
does compute the tail average, that the auxiliary scalar really is the
value at risk — are claims about optima, not about object graphs. Every
solve runs on the small sample so the whole file stays interactive.
"""

from __future__ import annotations

from dataclasses import replace

import cvxpy as cp
import numpy as np
import pytest

from app.contracts import (
    FloatArray,
    MarketScenarios,
    Scenario,
    frozen_float_array,
)
from app.cvxpy_api import cvar, is_dpp, solve
from app.errors import ModelError
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.model import (
    build_atom_oracle_problem,
    build_cvar_problem,
    build_variance_problem,
)
from app.model_desk import DUAL_BEARING_LABELS, desk_block, sample_covariance
from app.tailrisk import (
    array_digest,
    portfolio_losses,
    tail_count,
    tail_statistics,
)


def _solved(variable: cp.Variable) -> FloatArray:
    """Return a solved variable's value, failing if the solve left none behind."""
    value = variable.value
    assert value is not None, f"{variable.name()} has no value"
    return np.asarray(value, dtype=np.float64)


def _with_returns(market: MarketScenarios, returns: FloatArray) -> MarketScenarios:
    """Return a copy of `market` carrying a different matrix, digest and all."""
    frozen = frozen_float_array(returns)
    return replace(market, returns=frozen, digest=array_digest(frozen))


def _solved_cvar(
    scenario: Scenario, market: MarketScenarios, target: float, log: Logger
) -> tuple[cp.Problem, FloatArray]:
    """Solve the linear program at one target and hand back its weights."""
    built = build_cvar_problem(scenario, market, log=log)
    built.target.value = target
    solve(built.problem, solver=cp.CLARABEL)
    assert built.problem.status == cp.OPTIMAL
    return built.problem, _solved(built.weights)


def test_the_cvar_problem_is_a_disciplined_convex_program(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    built = build_cvar_problem(small_scenario, small_market, log=log)

    assert is_dpp(built.problem)
    assert built.problem.objective.NAME == "minimize"
    assert built.kind == "cvar"
    assert built.var_auxiliary is not None


def test_the_cvar_model_is_affine_which_is_why_simplex_can_solve_it(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Affine objective over affine (in)equalities is the definition of an LP.

    Checking `is_dcp()` would not establish this. A disciplined convex
    program is allowed a quadratic form, a norm, an exponential cone — and
    a simplex method can touch none of them. What makes this model a
    *linear* program is the stronger property tested here: the objective is
    affine, every constraint is an equality or an inequality, and both
    sides of every one of them are affine as well. That is the whole payoff
    of the Rockafellar-Uryasev reformulation, which trades a sort — not
    affine, not even differentiable — for `S` extra linear rows. HiGHS's
    simplex algorithm accepting the problem at the end is the independent
    witness: it takes linear programs and nothing else.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)

    assert built.problem.objective.args[0].is_affine()
    for index, constraint in enumerate(built.problem.constraints):
        assert isinstance(
            constraint, cp.constraints.Equality | cp.constraints.Inequality
        ), f"constraint {index} is a cone, not a linear (in)equality: {constraint}"
        for side, argument in enumerate(constraint.args):
            assert argument.is_affine(), (
                f"side {side} of constraint {index} is not affine: {argument}"
            )

    built.target.value = small_scenario.headline_target_monthly
    solve(built.problem, solver=cp.HIGHS, highs_options={"solver": "simplex"})
    assert built.problem.status == cp.OPTIMAL


def test_a_two_asset_five_scenario_instance_matches_a_hand_enumerated_optimum(
    tiny_scenario: Scenario, tiny_market: MarketScenarios, log: Logger
) -> None:
    """The one instance small enough to check without trusting the solver.

    Two names, five scenarios, a 60% confidence level so exactly two of
    them are in the tail, and a mandate that collapses the feasible set to
    the blends `w = (a, 1 - a)` for `a` in `[0, 1]`. Every such blend can
    be priced by brute force, so the linear program has somewhere
    independent to be checked against.

    The answer is also available in closed form. For `a` between 0.7 and
    0.8 the worst loss is the fourth scenario's `0.16a - 0.06` and the
    second worst switches from the fifth scenario's `0.11 - 0.17a` to the
    third's `0.01a - 0.03` at `a = 7/9`. The average of the worst two falls
    until that crossover and rises after it, so the optimum sits exactly at
    `a = 7/9` and is worth `19/900`.
    """
    built = build_cvar_problem(tiny_scenario, tiny_market, log=log)
    built.target.value = 0.0
    solve(built.problem, solver=cp.CLARABEL)

    grid_best = min(
        tail_statistics(
            portfolio_losses(tiny_market.returns, np.array([share, 1.0 - share])),
            tiny_scenario.cvar_beta,
        ).cvar
        for share in np.linspace(0.0, 1.0, 20_001)
    )

    assert built.problem.status == cp.OPTIMAL
    assert built.problem.value == pytest.approx(grid_best, abs=1e-4)
    assert built.problem.value == pytest.approx(19.0 / 900.0, abs=1e-6)
    assert _solved(built.weights)[0] == pytest.approx(7.0 / 9.0, abs=1e-4)


def test_the_auxiliary_scalar_recovers_the_empirical_var(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """`a` is not bookkeeping: at the optimum it is the value at risk.

    That is the part of the reformulation readers tend to disbelieve, and
    it is cheap to check — recompute the empirical VaR of the optimal book
    in plain NumPy and compare.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    built.target.value = small_scenario.headline_target_monthly
    solve(built.problem, solver=cp.CLARABEL)

    assert built.var_auxiliary is not None
    losses = portfolio_losses(small_market.returns, _solved(built.weights))
    stats = tail_statistics(losses, small_scenario.cvar_beta)

    assert built.var_auxiliary.value == pytest.approx(stats.var, abs=1e-5)


def test_the_objective_is_the_tail_average_of_the_book_it_chose(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The reported optimum has to survive being recomputed from the weights."""
    problem, weights = _solved_cvar(
        small_scenario, small_market, small_scenario.headline_target_monthly, log
    )
    stats = tail_statistics(
        portfolio_losses(small_market.returns, weights), small_scenario.cvar_beta
    )

    assert problem.value == pytest.approx(
        stats.cvar, abs=small_scenario.tolerances.cvar_agreement_abs
    )


def test_the_atom_oracle_reaches_the_same_optimum(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """A second derivation of the same number, sharing no algebra with the first.

    `sum_largest(losses, k) / k` says what CVaR *is*; the linear program
    says how to compute it without sorting. They are exactly equal when
    `(1 - beta) * S` is a whole number, which the fixture arranges, so
    agreement here is evidence about the hand derivation rather than about
    CVXPY. `k` comes from `tailrisk.tail_count` — the ceiling is never
    written out here or anywhere else.
    """
    target = small_scenario.headline_target_monthly
    scenario_count = small_market.returns.shape[0]
    in_tail = tail_count(scenario_count, small_scenario.cvar_beta)
    assert (1.0 - small_scenario.cvar_beta) * scenario_count == pytest.approx(
        in_tail, abs=1e-9
    )

    linear_program, _ = _solved_cvar(small_scenario, small_market, target, log)
    oracle = build_atom_oracle_problem(small_scenario, small_market, log=log)
    oracle.target.value = target
    solve(oracle.problem, solver=cp.CLARABEL)

    assert oracle.problem.status == cp.OPTIMAL
    assert oracle.problem.value == pytest.approx(
        linear_program.value, abs=small_scenario.tolerances.cvar_agreement_abs
    )


def test_the_cvxpy_cvar_atom_reaches_the_same_optimum_as_well(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """A third path: CVXPY's own `cvar` atom over the identical desk block.

    The lab does not build this one, because `sum_largest` already gives an
    independent oracle and this atom is a thin wrapper over it. It is worth
    one test anyway: it is the spelling a reader reaching for CVXPY would
    try first, and showing it lands on the same number is what justifies
    the claim that the hand-written program is not doing anything exotic.
    """
    target = small_scenario.headline_target_monthly
    linear_program, _ = _solved_cvar(small_scenario, small_market, target, log)

    block = desk_block(small_scenario, small_market.returns)
    block.target.value = target
    losses = -(small_market.returns @ block.variables.weights)
    problem = cp.Problem(
        cp.Minimize(cvar(losses, small_scenario.cvar_beta)),
        list(block.families.values()),
    )
    solve(problem, solver=cp.CLARABEL)

    assert problem.status == cp.OPTIMAL
    assert problem.value == pytest.approx(
        linear_program.value, abs=small_scenario.tolerances.cvar_agreement_abs
    )


def test_the_atom_oracle_refuses_a_fractional_tail_count(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Off an integer tail the oracle and the program answer different questions.

    `sum_largest(L, k) / k` averages a whole number of scenarios; the
    linear program divides by `(1 - beta) * S` whatever that is. Where the
    two differ the comparison proves nothing, so the oracle declines to be
    built rather than quietly reporting a mismatch as a disagreement.
    """
    # 590 of the 600 scenarios: a 95% tail of 29.5 scenarios, which is
    # not a number of scenarios anyone can average.
    awkward = _with_returns(small_market, small_market.returns[:590])

    with pytest.raises(ModelError, match="whole number"):
        build_atom_oracle_problem(small_scenario, awkward, log=log)


def test_an_unreachable_return_target_is_reported_infeasible(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """A 100%-a-month target is refused, and no weights are left behind."""
    built = build_cvar_problem(small_scenario, small_market, log=log)
    built.target.value = 1.0
    solve(built.problem, solver=cp.CLARABEL)

    assert built.problem.status in (cp.INFEASIBLE, cp.INFEASIBLE_INACCURATE)
    assert built.weights.value is None


def test_the_variance_problem_shares_every_linear_constraint(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The control differs by its objective and by nothing else."""
    cvar = build_cvar_problem(small_scenario, small_market, log=log)
    variance = build_variance_problem(small_scenario, small_market, log=log)

    assert set(variance.labelled) == set(cvar.labelled)
    assert variance.var_auxiliary is None
    assert is_dpp(variance.problem)
    assert variance.kind == "variance"
    # The linear program carries one extra family, the per-scenario
    # shortfall rows; everything below that is the same mandate.
    assert len(variance.problem.constraints) == len(cvar.problem.constraints) - 1


def test_every_model_names_the_same_five_dual_bearing_constraints(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The dual table is keyed by these labels, so they are part of the contract."""
    for built in (
        build_cvar_problem(small_scenario, small_market, log=log),
        build_variance_problem(small_scenario, small_market, log=log),
        build_atom_oracle_problem(small_scenario, small_market, log=log),
    ):
        assert tuple(built.labelled) == DUAL_BEARING_LABELS
        assert all(
            constraint in built.problem.constraints
            for constraint in built.labelled.values()
        )


def test_the_variance_problem_accepts_a_near_singular_sample_covariance(
    scenario: Scenario, log: Logger
) -> None:
    """Fewer scenarios than names leaves the covariance rank-deficient.

    Its smallest eigenvalues then come out as floating-point noise either
    side of zero, and a positive-semidefinite test that takes them at face
    value refuses the matrix. At this lab's return scale the noise is small
    enough that CVXPY's own tolerance lets it through anyway, so the second
    half of this test scales the returns up until it does not — which is
    what `psd_wrap` is insurance against: an assertion that a covariance
    matrix is PSD by construction, whatever the arithmetic says.
    """
    market = generate_scenarios(
        scenario.universe, scenario.market, seed=11, count=10, mode="gaussian", log=log
    )
    covariance = sample_covariance(market.returns)
    assert np.linalg.matrix_rank(covariance) < len(scenario.universe.names)
    assert np.linalg.eigvalsh(covariance).min() <= 0.0

    built = build_variance_problem(scenario, market, log=log)
    assert is_dpp(built.problem)
    built.target.value = 0.0
    solve(built.problem, solver=cp.CLARABEL)
    assert built.problem.status == cp.OPTIMAL

    amplified = _with_returns(market, market.returns * 1_000.0)
    noisy = sample_covariance(amplified.returns)
    weights = cp.Variable(len(scenario.universe.names))
    assert not cp.quad_form(weights, noisy).is_convex()
    assert is_dpp(build_variance_problem(scenario, amplified, log=log).problem)


def test_the_return_target_is_measured_against_the_sample_mean(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The model is held to the matrix it optimizes on, not to the intent.

    `universe.expected_return` is what the generator was asked for; the
    column means of the drawn matrix are what it produced. Pricing the
    return constraint off the second means the optimizer can never be right
    about a portfolio the scenarios disagree with. The two differ by real
    sampling error, which is the point of the last assertion.
    """
    universe = small_scenario.universe
    built = build_cvar_problem(small_scenario, small_market, log=log)
    target = small_scenario.headline_target_monthly
    built.target.value = target
    solve(built.problem, solver=cp.CLARABEL)

    borrow = universe.borrow_fee_annual / 12.0
    costs = borrow @ _solved(built.short_leg) + (
        universe.half_spread @ _solved(built.turnover_leg)
    )
    weights = _solved(built.weights)
    sample_mean_return = small_market.returns.mean(axis=0) @ weights - costs
    intended_return = universe.expected_return @ weights - costs

    assert sample_mean_return == pytest.approx(target, abs=1e-9)
    assert abs(intended_return - sample_mean_return) > 1e-5


def test_the_signed_split_stays_exact_where_the_costs_make_it_so(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """No name ends up carrying a long leg and a short leg at once.

    `w = l - s` only bounds `|w|` from above. Here the gross cap binds and
    every name pays to be shorted or traded, so inflating both legs is
    strictly worse and the relaxation is tight.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    built.target.value = small_scenario.headline_target_monthly
    solve(built.problem, solver=cp.CLARABEL)

    overlap = np.minimum(_solved(built.long_leg), _solved(built.short_leg)).max()
    assert overlap <= small_scenario.tolerances.relaxation_abs


def test_a_return_matrix_that_does_not_fit_the_universe_is_rejected(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Every builder refuses a matrix with the wrong number of columns."""
    mismatched = _with_returns(small_market, small_market.returns[:, :5])

    for build in (
        build_cvar_problem,
        build_variance_problem,
        build_atom_oracle_problem,
    ):
        with pytest.raises(ModelError, match="one column per universe name"):
            build(small_scenario, mismatched, log=log)
