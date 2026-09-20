"""Tests for the pass that is allowed to disbelieve the solver.

Two of these are about the verifier's independence rather than its
arithmetic — that it never loads CVXPY, and that it rejects a weight
vector that breaches a cap even though a `SolveOutcome` says the solve was
optimal. Those are the tests that make the rest of the file mean anything:
a verifier that reads the model's own expressions is only asking the
solver to agree with itself.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app import verification, verification_checks, verification_exposures
from app.contracts import (
    MarketScenarios,
    PortfolioSolution,
    Scenario,
    SolveOutcome,
    VerificationReport,
    frozen_float_array,
)
from app.errors import VerificationError
from app.logging_setup import Logger
from app.model import build_atom_oracle_problem, build_cvar_problem
from app.solver import solve_problem
from app.tailrisk import portfolio_losses, tail_statistics
from app.verification import relaxation_overlap, verify_solution
from app.verification_exposures import (
    cost_ledger,
    threshold_count,
    var_interval,
)

# The whole of the verifier, listed so the independence tests below cover
# the helper modules and not just the entry point.
VERIFICATION_MODULES = (verification, verification_checks, verification_exposures)


def _solved(
    scenario: Scenario, market: MarketScenarios, target: float, log: Logger
) -> SolveOutcome:
    """Solve the linear program at one target with the reference algorithm."""
    built = build_cvar_problem(scenario, market, log=log)
    return solve_problem(built, algorithm="CLARABEL", target=target, log=log)


def _oracle_cvar(
    scenario: Scenario, market: MarketScenarios, target: float, log: Logger
) -> float:
    """Solve the independent `sum_largest` path to the same tail average."""
    built = build_atom_oracle_problem(scenario, market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=target, log=log)
    assert outcome.solution is not None
    return outcome.solution.objective


def _report(
    scenario: Scenario,
    market: MarketScenarios,
    out_of_sample: MarketScenarios,
    log: Logger,
) -> tuple[SolveOutcome, VerificationReport]:
    """Solve at the scenario's headline target and verify what comes back."""
    target = scenario.headline_target_monthly
    outcome = _solved(scenario, market, target, log)
    report = verify_solution(
        scenario,
        market,
        out_of_sample,
        outcome,
        _oracle_cvar(scenario, market, target, log),
        target=target,
        log=log,
    )
    return outcome, report


def test_the_verifier_never_imports_cvxpy() -> None:
    """The letter of the rule: no `import cvxpy` in any verification module."""
    for module in VERIFICATION_MODULES:
        source = Path(module.__file__ or "").read_text(encoding="utf-8")
        assert "import cvxpy" not in source


def test_the_verifier_can_be_imported_without_cvxpy_being_loaded() -> None:
    """The spirit of the rule, which the grep above does not cover.

    A module can stay free of the string `import cvxpy` and still reach a
    CVXPY object through a neighbour — `model_desk.sample_mean` would have
    been the tempting one, since it computes exactly the mean vector the
    return check needs, and importing it would have dragged the whole
    modelling layer in behind it. Importing the verifier into a clean
    interpreter and asking whether CVXPY arrived with it is the check that
    catches that.
    """
    probe = "import app.verification, sys; print('cvxpy' in sys.modules)"
    finished = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=True
    )

    assert finished.stdout.strip() == "False"


def test_relaxation_overlap_catches_a_padded_split() -> None:
    assert relaxation_overlap(
        np.array([0.3, 0.0]), np.array([0.0, 0.2])
    ) == pytest.approx(0.0)
    assert relaxation_overlap(
        np.array([0.3, 0.1]), np.array([0.1, 0.2])
    ) == pytest.approx(0.1)


def test_verification_recomputes_every_desk_constraint(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    outcome, report = _report(small_scenario, small_market, small_out_of_sample, log)
    assert outcome.solution is not None
    weights = outcome.solution.weights
    universe = small_scenario.universe

    assert report.gross_leverage == pytest.approx(np.abs(weights).sum())
    assert report.net_exposure == pytest.approx(weights.sum())
    assert report.portfolio_beta == pytest.approx(universe.market_beta @ weights)
    assert report.turnover == pytest.approx(np.abs(weights - universe.start_book).sum())
    assert report.name_gross_max == pytest.approx(np.abs(weights).max())
    assert report.sector_net == pytest.approx(universe.sector_matrix @ weights)
    assert report.sector_gross == pytest.approx(
        universe.sector_matrix @ np.abs(weights)
    )
    assert dict(report.checks)["gross_leverage_within_cap"] is True


def test_the_cost_ledger_is_rebuilt_from_the_weights_not_the_solver_legs(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """Borrow and trading cost come from `w` and `w0`, never from `s` and `t`.

    The solver's short leg and turnover leg are upper bounds on short
    notional and traded notional, not equalities. Reading them here would
    make the relaxation-exactness check circular — the verifier would be
    pricing the book with the same padded numbers it is supposed to test.
    """
    outcome, report = _report(small_scenario, small_market, small_out_of_sample, log)
    assert outcome.solution is not None
    weights = outcome.solution.weights
    universe = small_scenario.universe

    assert report.expected_gross_return == pytest.approx(
        small_market.returns.mean(axis=0) @ weights
    )
    assert report.borrow_cost == pytest.approx(
        (universe.borrow_fee_annual / 12.0) @ np.maximum(-weights, 0.0)
    )
    assert report.trading_cost == pytest.approx(
        universe.half_spread @ np.abs(weights - universe.start_book)
    )
    assert report.expected_net_return == pytest.approx(
        report.expected_gross_return - report.borrow_cost - report.trading_cost
    )
    assert report.expected_net_return >= small_scenario.headline_target_monthly


def test_the_three_cvar_paths_agree(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    _, report = _report(small_scenario, small_market, small_out_of_sample, log)
    tolerance = small_scenario.tolerances.cvar_agreement_abs

    assert report.model_objective == pytest.approx(report.empirical_cvar, abs=tolerance)
    assert report.atom_oracle_cvar == pytest.approx(
        report.empirical_cvar, abs=tolerance
    )


def test_the_auxiliary_scalar_lands_inside_the_optimal_var_interval(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """Containment, not equality — the optimum in `a` is a segment.

    See `verification_exposures.var_interval` for why. On this fixture the
    segment happens to be about 1.8e-13 wide, because fifteen scenarios sit
    on the VaR threshold and collapse it, and the measured distance from it
    is zero — Clarabel lands inside. Neither number is something the test
    may depend on: both move with the mandate and with the draw, so what is
    asserted is containment within the tolerance the scenario allows.
    """
    outcome, report = _report(small_scenario, small_market, small_out_of_sample, log)
    assert outcome.solution is not None
    auxiliary = outcome.solution.var_auxiliary
    losses = portfolio_losses(small_market.returns, outcome.solution.weights)
    lower, upper = var_interval(losses, small_scenario.cvar_beta)
    tolerance = small_scenario.tolerances.var_recovery_abs

    assert report.var_recovery_gap >= 0.0
    assert report.var_recovery_gap <= tolerance
    assert lower - tolerance <= auxiliary <= upper + tolerance
    assert report.in_sample.var == pytest.approx(upper)


def test_the_threshold_count_is_reported_rather_than_asserted(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """How many scenarios sit on the VaR threshold is a fact, not a rule.

    It is the reason the optimal segment above collapses to a point on the
    shipped mandate, so it is worth printing — but a reader who edits the
    scenario can move it, and nothing should break when they do.
    """
    outcome, report = _report(small_scenario, small_market, small_out_of_sample, log)
    assert outcome.solution is not None
    losses = portfolio_losses(small_market.returns, outcome.solution.weights)

    on_threshold = threshold_count(
        losses,
        small_scenario.cvar_beta,
        tolerance=small_scenario.tolerances.var_recovery_abs,
    )

    assert report.threshold_count == on_threshold
    assert 1 <= on_threshold <= losses.shape[0]
    # It is reported, so it reaches `solution.json`; it is never a pass
    # mark, so no check bears its name.
    assert "threshold_count" not in dict(report.checks)


def test_out_of_sample_cvar_is_scored_on_the_disjoint_matrix(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    outcome, report = _report(small_scenario, small_market, small_out_of_sample, log)
    assert outcome.solution is not None
    expected = tail_statistics(
        portfolio_losses(small_out_of_sample.returns, outcome.solution.weights),
        small_scenario.cvar_beta,
    )

    assert report.out_of_sample.cvar == pytest.approx(expected.cvar)
    assert report.out_of_sample.var == pytest.approx(expected.var)
    assert report.out_of_sample.tail_count == expected.tail_count
    assert report.out_of_sample.cvar != pytest.approx(report.in_sample.cvar)


def test_verification_rejects_weights_that_breach_a_cap(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """A hand-built outcome that claims to be optimal and is not.

    Nothing about a `SolveOutcome` is trustworthy on its face — it is a
    plain dataclass, and a bug anywhere between the solver and the report
    could fill one with anything. Doubling the weights of a solved book
    doubles its gross leverage, which the mandate caps, so the verifier has
    to refuse it and has to say which check refused it.
    """
    outcome = _solved(
        small_scenario, small_market, small_scenario.headline_target_monthly, log
    )
    assert outcome.solution is not None
    tampered = replace(
        outcome,
        solution=replace(
            outcome.solution,
            weights=frozen_float_array(outcome.solution.weights * 2.0),
        ),
    )

    with pytest.raises(VerificationError, match="gross_leverage_within_cap"):
        verify_solution(
            small_scenario,
            small_market,
            small_out_of_sample,
            tampered,
            0.0,
            target=small_scenario.headline_target_monthly,
            log=log,
        )


def test_verification_refuses_an_outcome_that_carries_no_solution(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    infeasible = _solved(small_scenario, small_market, 1.0, log)

    with pytest.raises(VerificationError, match="infeasible"):
        verify_solution(
            small_scenario,
            small_market,
            small_out_of_sample,
            infeasible,
            0.0,
            target=small_scenario.headline_target_monthly,
            log=log,
        )


def test_the_first_failing_check_in_report_order_is_the_one_raised(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """Report order decides which failure is raised, and that order is fixed.

    Substituting the starting book satisfies every desk limit — the loader
    rejects a scenario whose start book does not — and leaves the turnover
    at zero, so the first thing wrong with it is that it does not earn the
    demanded return. The message has to name that check and not the tail
    agreements behind it, which by then are wrong too.
    """
    outcome = _solved(
        small_scenario, small_market, small_scenario.headline_target_monthly, log
    )
    assert outcome.solution is not None
    unchanged_book = replace(
        outcome,
        solution=replace(outcome.solution, weights=small_scenario.universe.start_book),
    )

    with pytest.raises(VerificationError, match="return_target_met"):
        verify_solution(
            small_scenario,
            small_market,
            small_out_of_sample,
            unchanged_book,
            0.0,
            target=small_scenario.headline_target_monthly,
            log=log,
        )


def test_the_return_check_uses_the_solved_target_not_the_headline(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """The frontier sweep solves twenty-five targets; only one is the headline.

    A book solved at 0.006 meets 0.006 and does not meet 0.009. Verifying
    it against the target it was actually solved at passes; verifying the
    same book against a target nobody solved it for fails, and names the
    return check. If `verify_solution` read the scenario's headline
    instead, both calls would return the same verdict and one of them
    would be silently wrong.

    0.006 rather than something lower because the return constraint has to
    be *active* at the target chosen — see
    `test_the_split_lapses_wherever_the_return_target_goes_slack` below for
    what happens when it is not.
    """
    modest = 0.006
    outcome = _solved(small_scenario, small_market, modest, log)
    oracle = _oracle_cvar(small_scenario, small_market, modest, log)

    report = verify_solution(
        small_scenario,
        small_market,
        small_out_of_sample,
        outcome,
        oracle,
        target=modest,
        log=log,
    )
    assert dict(report.checks)["return_target_met"] is True

    with pytest.raises(VerificationError, match="return_target_met"):
        verify_solution(
            small_scenario,
            small_market,
            small_out_of_sample,
            outcome,
            oracle,
            target=0.009,
            log=log,
        )


def test_a_nan_weight_is_named_as_a_nan_weight(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """A NaN book is diagnosed as a NaN book, not as a cap breach.

    This is why `weights_finite` runs first. Every comparison against a NaN
    is false, so with the mandate ahead of it a single NaN weight would
    have been reported as `gross_leverage_within_cap` failing — sending a
    reader to look at limits that are perfectly fine. Finite weights are
    the precondition for all the arithmetic behind them, so they are
    checked before any of it.
    """
    universe = small_scenario.universe
    poisoned = np.zeros(len(universe.names))
    poisoned[0] = np.nan
    outcome = SolveOutcome(
        status="optimal",
        solution=PortfolioSolution(
            weights=frozen_float_array(poisoned),
            long_leg=frozen_float_array(np.zeros(len(universe.names))),
            short_leg=frozen_float_array(np.zeros(len(universe.names))),
            turnover_leg=frozen_float_array(np.abs(universe.start_book)),
            var_auxiliary=0.0,
            objective=0.0,
        ),
        solver_name="CLARABEL",
        solve_seconds=0.0,
        iterations=1,
        duals={},
    )

    with pytest.raises(VerificationError, match="weights_finite"):
        verify_solution(
            small_scenario,
            small_market,
            small_out_of_sample,
            outcome,
            float("nan"),
            target=small_scenario.headline_target_monthly,
            log=log,
        )


def test_the_signed_split_lapses_once_nothing_penalises_an_inflated_pair(
    degenerate_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The fixture that earns the relaxation caveat in `model_desk.py`.

    Two things can make `w = l - s` exact at an optimum: a gross, per-name
    or per-sector cap that binds, since all three are written on `l + s`;
    or a binding return target together with a positive borrow fee, which
    is charged on `s`. The half-spread is deliberately not on that list —
    it multiplies `t`, which padding `(l, s)` cannot move. This scenario
    removes both premises, and the turnover bound's two as well, so that
    the optimal face of the linear program contains a whole set of
    `(l, s)` pairs differing only in how much padding they carry.

    What happens next is a property of the algorithm, not a theorem.
    Clarabel is an interior-point method and returns a point in the
    relative interior of that face, so it pads both legs by 0.094 of NAV
    on the worst name. HiGHS's simplex finishes at a vertex, where the
    padding is zero. Both answers are optimal; only one of them has
    `l + s == |w|`. That is the honest statement of what this fixture
    shows, and it is why the lab measures the overlap and reports it rather
    than assuming it away.
    """
    target = degenerate_scenario.headline_target_monthly
    built = build_cvar_problem(degenerate_scenario, small_market, log=log)
    interior = solve_problem(built, algorithm="CLARABEL", target=target, log=log)
    vertex = solve_problem(built, algorithm="HIGHS_SIMPLEX", target=target, log=log)
    assert interior.solution is not None
    assert vertex.solution is not None

    # Every premise of the exactness argument really is gone: the caps are
    # slack at the optimum, not merely generous in the file.
    limits, universe = degenerate_scenario.limits, degenerate_scenario.universe
    weights = interior.solution.weights
    assert not universe.borrow_fee_annual.any()
    assert not universe.half_spread.any()
    assert np.abs(weights).sum() < 0.5 * limits.gross_leverage_max
    assert np.abs(weights).max() < 0.5 * limits.name_gross_cap
    assert (universe.sector_matrix @ np.abs(weights)).max() < (
        0.5 * limits.sector_gross_cap
    )
    assert np.abs(weights - universe.start_book).sum() < 0.5 * limits.turnover_max

    interior_overlap = relaxation_overlap(
        interior.solution.long_leg, interior.solution.short_leg
    )
    vertex_overlap = relaxation_overlap(
        vertex.solution.long_leg, vertex.solution.short_leg
    )
    tolerance = degenerate_scenario.tolerances.relaxation_abs

    assert interior_overlap > 1_000 * tolerance
    assert vertex_overlap <= tolerance
    # The two disagree about the legs and agree about the portfolio, which
    # is the point: the padding is invisible in `w`.
    assert vertex.solution.weights == pytest.approx(weights, abs=1e-6)


def test_the_turnover_bound_lapses_on_the_same_terms(
    degenerate_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """`t >= |w - w0|` is the same shape of relaxation as the signed split.

    With every half-spread at zero and the budget slack, nothing pushes `t`
    back down onto the trade it is supposed to measure, and an
    interior-point solve leaves it floating above by about 0.12 of NAV on
    the worst name.
    """
    built = build_cvar_problem(degenerate_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=degenerate_scenario.headline_target_monthly,
        log=log,
    )
    assert outcome.solution is not None
    traded = np.abs(outcome.solution.weights - degenerate_scenario.universe.start_book)

    padding = float((outcome.solution.turnover_leg - traded).max())

    assert padding > 1_000 * degenerate_scenario.tolerances.relaxation_abs


def test_the_split_lapses_wherever_the_return_target_goes_slack(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Borrow and spread only penalise padding while the return constraint binds.

    This one is worth reading carefully, because it narrows the exactness
    argument in `model_desk.py` to something smaller than it first looks.

    The borrow fee and the half-spread never enter the objective — by
    design, they sit in the expected-net-return constraint and nowhere
    else, which is the simplification the README states. So they make an
    inflated `(l, s)` pair *strictly worse* only when that constraint is
    active. Let the return target go slack and the costs stop being a
    penalty at all: padding both legs spends return the book does not need
    and changes the tail loss not at all, so the optimal face widens and an
    interior-point solver settles somewhere inside it.

    Measured on the shipped desk mandate, not on the degenerate fixture.
    At 600 scenarios and a 0.002 target the book earns 0.004925 against a
    target of 0.002 — 2.9e-03 of slack — the gross cap sits at 0.86 of
    1.32, and the split comes back padded by 1.2e-02; at 0.006 the return
    constraint binds exactly and the padding collapses to 1.7e-09. At the
    shipped 10,000 scenarios the same 0.002 target gives a book earning
    0.003689 at 0.82 gross, padded by 1.3e-02.

    Isolating the two costs at 600 scenarios and 0.006 shows which one is
    doing the work: both costs 1.7e-09, borrow fee alone 2.0e-09, and the
    half-spread alone 1.1e-02 — no better than charging nothing at all.

    Two consequences worth carrying forward. The exactness premise is
    "a binding gross cap, or a binding return target with positive costs",
    not "positive costs" on their own. And `verify_solution` will refuse
    the low-return end of the frontier sweep with `relaxation_exact` — not
    because the verifier is wrong, but because the relaxation really has
    lapsed there and the verifier is built to say so.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    slack = solve_problem(built, algorithm="CLARABEL", target=0.002, log=log)
    binding = solve_problem(built, algorithm="CLARABEL", target=0.006, log=log)
    assert slack.solution is not None
    assert binding.solution is not None
    universe = small_scenario.universe
    tolerance = small_scenario.tolerances.relaxation_abs

    # The premise really is absent at the slack target: costs are positive,
    # but the constraint that charges for them has room to spare.
    assert universe.borrow_fee_annual.any()
    assert universe.half_spread.any()
    ledger = cost_ledger(universe, small_market.returns, slack.solution.weights)
    assert ledger.expected_net_return - 0.002 > 1e-3
    assert (
        np.abs(slack.solution.weights).sum() < small_scenario.limits.gross_leverage_max
    )

    assert (
        relaxation_overlap(slack.solution.long_leg, slack.solution.short_leg)
        > 1_000 * tolerance
    )
    assert (
        relaxation_overlap(binding.solution.long_leg, binding.solution.short_leg)
        <= tolerance
    )


def test_the_shipped_mandate_keeps_both_relaxations_tight(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    """The other half of the story: with the premises in place, no padding.

    Same solver, same model, same sample — only the fees, the spreads and
    the binding budgets are back. The overlap collapses from 9.4e-02 to
    1.1e-10 here, and to exactly zero at the shipped 10,000 scenarios.
    """
    _, report = _report(small_scenario, small_market, small_out_of_sample, log)

    assert report.relaxation_max_overlap <= small_scenario.tolerances.relaxation_abs
    assert dict(report.checks)["relaxation_exact"] is True


def test_every_check_is_reported_in_order_and_all_of_them_pass(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    small_out_of_sample: MarketScenarios,
    log: Logger,
) -> None:
    _, report = _report(small_scenario, small_market, small_out_of_sample, log)

    assert [name for name, _ in report.checks] == [
        "weights_finite",
        "gross_leverage_within_cap",
        "net_exposure_within_band",
        "beta_within_band",
        "name_gross_within_cap",
        "sector_net_within_cap",
        "sector_gross_within_cap",
        "turnover_within_budget",
        "return_target_met",
        "relaxation_exact",
        "cvar_matches_model_objective",
        "cvar_matches_atom_oracle",
        "var_recovered_from_auxiliary",
    ]
    assert all(passed for _, passed in report.checks)
