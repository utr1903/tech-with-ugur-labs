"""Behaviour tests for the shadow-price table and its re-solve check.

Every test runs on the 600-scenario fixture, where the live set at the
headline target is `return_target`, `turnover_budget` and `beta_lower` —
a different three from the shipped 10,000 scenarios, which is the point of
deciding activity per solve rather than writing a fixed list down.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app import duals, duals_check
from app.contracts import DualRow, MarketScenarios, Scenario, SolveOutcome
from app.duals import build_dual_table
from app.duals_check import agrees
from app.duals_constraints import (
    ConstraintRow,
    constraint_rows,
    is_active,
    nudge_step,
    with_limit,
)
from app.errors import SolveError
from app.logging_setup import Logger
from app.model import BuiltProblem, build_cvar_problem
from app.model_desk import DUAL_BEARING_LABELS, MONTHS_PER_YEAR, sample_mean
from app.solver import solve_problem

# A target the 600-scenario mandate reaches with room to spare, used to
# show what an inactive return constraint does to the signed split.
SLACK_TARGET = 0.002

# The arm that separates the turnover row from the real trade: a budget
# wide enough to have no say, and a target low enough that the half-spread
# charges for nothing. Both of the turnover bound's premises are then gone
# and `t` floats free, which is the only state in which a measurement on
# `sum |w - w0|` is distinguishable from one on `sum(t)`.
WIDE_TURNOVER_BUDGET = 8.0
FLOATING_LEG_TARGET = -0.02


@pytest.fixture(scope="session")
def priced_book(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> tuple[BuiltProblem, tuple[DualRow, ...]]:
    """Solve the headline book once and price its limits."""
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=small_scenario.headline_target_monthly,
        log=log,
    )
    rows = build_dual_table(small_scenario, small_market, built, outcome, log=log)
    return built, rows


@pytest.fixture(scope="session")
def dual_rows(
    priced_book: tuple[BuiltProblem, tuple[DualRow, ...]],
) -> tuple[DualRow, ...]:
    """The priced table for the headline book."""
    return priced_book[1]


def test_the_table_prices_every_labelled_constraint_in_order(
    dual_rows: tuple[DualRow, ...],
) -> None:
    """One row per label the model marks dual-bearing, in the model's order."""
    assert tuple(row.label for row in dual_rows) == DUAL_BEARING_LABELS


def test_a_dual_matches_its_finite_difference_re_solve(
    dual_rows: tuple[DualRow, ...],
) -> None:
    """Every active row's price is confirmed by moving its bound and re-solving.

    A dual is a claim about a derivative of the optimal value, so the check
    is to measure that derivative: nudge the right-hand side up and down by
    `h` and take a central difference. The two have to agree within
    `tolerances.dual_relative`.
    """
    active = [row for row in dual_rows if row.active]
    assert active
    for row in active:
        assert row.finite_difference is not None
        assert row.agrees


def test_an_inactive_constraint_reports_a_zero_dual_and_skips_the_re_solve(
    dual_rows: tuple[DualRow, ...],
) -> None:
    """A limit the book is nowhere near costs nothing and is not re-solved.

    At 600 scenarios the gross-leverage cap and the beta band's upper side
    are both slack at the headline target — the book runs 1.1922 of a 1.32
    cap and its beta sits on the *lower* edge of the band — and their duals
    come back at 2.4e-13 and 5.7e-13. That is machine noise, not a small
    price. Two nudged re-solves would cost real time to measure a
    derivative of zero, so they are skipped, and `agrees` stays false
    because nothing confirmed anything.
    """
    inactive = [row for row in dual_rows if not row.active]
    assert inactive
    for row in inactive:
        assert row.dual_value == pytest.approx(0.0, abs=1e-6)
        assert row.finite_difference is None
        assert row.agrees is False


def test_the_finite_difference_carries_the_constraint_s_own_sign(
    dual_rows: tuple[DualRow, ...],
) -> None:
    """Loosening a ceiling lowers the objective; raising a floor lifts it.

    CVXPY reports a nonnegative dual whichever way a constraint is
    written — it is the rate at which the objective worsens as the bound
    tightens — so the sign of the measured slope is information the dual
    on its own does not carry. `return_target` and `beta_lower` are `>=`
    rows, so raising their bound can only raise the tail loss;
    `gross_leverage`, `turnover_budget` and `beta_upper` are `<=` rows,
    so raising theirs can only lower it.
    """
    rising = {"return_target", "beta_lower"}
    for row in dual_rows:
        if row.finite_difference is None:
            continue
        assert row.dual_value >= -1e-9
        if row.label in rising:
            assert row.finite_difference > 0.0
        else:
            assert row.finite_difference < 0.0


def test_the_gross_row_is_measured_on_the_legs_and_not_on_the_weights(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The gross cap is written on `l + s`, and `sum |w|` is a different number.

    Where the return target has slack, nothing in the program penalises
    holding a name long and short at once, so the legs inflate until they
    fill whatever gross budget exists. At 600 scenarios and a 0.002 target
    the book's own `sum |w|` is 0.8597 while `sum(l + s)` — the expression
    the constraint is actually written on — is 1.3144 against a 1.32 cap.
    A measurement taken on `sum |w|` would report 0.46 of spare balance
    sheet where the row the solver sees has 0.0056.

    The test asserts the *relationship*, not the two constants, so it keeps
    holding when the mandate is recalibrated: the two expressions differ,
    the model's own one is the larger, and it is the one near the cap.
    Swapping the implementation to `sum |w|` fails the third assertion;
    swapping the two fails the last.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=SLACK_TARGET, log=log)
    assert outcome.solution is not None
    solution = outcome.solution

    rows = {
        row.label: row
        for row in constraint_rows(
            small_scenario, small_market.returns, solution, target=SLACK_TARGET
        )
    }
    gross_row = rows["gross_leverage"]
    portfolio_gross = float(np.abs(solution.weights).sum())
    cap = small_scenario.limits.gross_leverage_max

    assert gross_row.right_hand_side == cap
    assert gross_row.left_hand_side == pytest.approx(
        float(np.sum(solution.long_leg + solution.short_leg))
    )
    # The signed split has lapsed here, so the two expressions part company
    # and the model's one is the larger of the two.
    assert gross_row.left_hand_side > portfolio_gross + 0.2
    # And it is the model's one that is nearly out of room.
    assert gross_row.slack < 0.01
    assert cap - portfolio_gross > 0.2


def test_the_turnover_row_is_measured_on_the_leg_and_not_on_the_real_trade(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The turnover budget is written on `sum(t)`, not on `sum |w - w0|`.

    At the shipped mandate those two coincide to better than 1e-10, because
    the budget binds and pushes `t` down onto the real trade. An
    implementation that quietly measured the real trade instead would
    therefore pass every test taken at the shipped settings — and would
    turn wrong the moment an edit gave the budget some slack. So the arm
    here removes both of `t`'s premises, with every other term pinned: the
    shipped mandate, both costs on, `turnover_max` widened 0.50 -> 8.0 so
    the budget has 6.06 of room at 600 scenarios, and the return target set
    to -0.02, where the return constraint has 1.70e-02 of slack so the
    half-spread charges for nothing.

    There `sum(t)` is 1.9438 while the real trade is 1.3200 — a gap of
    6.24e-01 of NAV at 600 scenarios, and 4.33e-02 at the shipped 10,000.
    A measurement on the real trade reports 1.3200 and is wrong by that
    much.
    """
    loose = with_limit(small_scenario, "turnover_budget", WIDE_TURNOVER_BUDGET)
    built = build_cvar_problem(loose, small_market, log=log)
    outcome = solve_problem(
        built, algorithm="CLARABEL", target=FLOATING_LEG_TARGET, log=log
    )
    assert outcome.solution is not None
    solution = outcome.solution

    rows = {
        row.label: row
        for row in constraint_rows(
            loose, small_market.returns, solution, target=FLOATING_LEG_TARGET
        )
    }
    turnover_row = rows["turnover_budget"]
    real_trade = float(np.abs(solution.weights - loose.universe.start_book).sum())

    # Both premises really are absent, so this arm is reproducible.
    assert turnover_row.slack > 5.0
    assert rows["return_target"].slack > 1e-2

    assert turnover_row.right_hand_side == WIDE_TURNOVER_BUDGET
    assert turnover_row.left_hand_side == pytest.approx(
        float(np.sum(solution.turnover_leg))
    )
    assert turnover_row.left_hand_side > real_trade + 0.5


def test_the_return_row_is_measured_on_the_model_s_costs_not_the_book_s(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The return constraint charges borrow on `s` and spread on `t`.

    The verifier recomputes the same quantity from the weights alone —
    borrow on `max(-w, 0)`, spread on `|w - w0|` — and gets a *better*
    number wherever a relaxation has lapsed, because the legs can only
    overstate the book's costs. That gap is the thing the verifier exists
    to measure, so using its version here would price the wrong row.

    At 600 scenarios and a 0.002 target, where the signed split is padded
    by 1.20e-02 on the worst name, the model's left-hand side is 0.0046375
    and the from-weights version is 0.0049246 — the row is 2.87e-04 of
    monthly return worse off than the book actually is. At the shipped
    10,000 scenarios the same gap is 3.06e-04.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=SLACK_TARGET, log=log)
    assert outcome.solution is not None
    solution = outcome.solution
    universe = small_scenario.universe

    rows = {
        row.label: row
        for row in constraint_rows(
            small_scenario, small_market.returns, solution, target=SLACK_TARGET
        )
    }
    return_row = rows["return_target"]
    monthly_borrow = universe.borrow_fee_annual / MONTHS_PER_YEAR
    gross_return = float(sample_mean(small_market.returns) @ solution.weights)

    from_legs = (
        gross_return
        - float(monthly_borrow @ solution.short_leg)
        - float(universe.half_spread @ solution.turnover_leg)
    )
    from_weights = (
        gross_return
        - float(monthly_borrow @ np.maximum(-solution.weights, 0.0))
        - float(universe.half_spread @ np.abs(solution.weights - universe.start_book))
    )

    # The split has lapsed here, which is what makes the two differ at all.
    assert float(np.minimum(solution.long_leg, solution.short_leg).max()) > 1e-3
    assert return_row.left_hand_side == pytest.approx(from_legs)
    assert from_weights > return_row.left_hand_side + 1e-4


def test_a_row_can_sit_close_to_its_cap_and_still_be_worth_nothing(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Closeness is not activity, and neither of them is scarcity.

    At the 0.002 target the gross row sits 0.0056 from its 1.32 cap at 600
    scenarios and 0.0031 at 10,000 — a few parts in a thousand of the cap,
    which looks for all the world like a limit about to bite. It is not
    binding: under the shipped `constraint_abs` of 1e-7 the row is
    *inactive*, and `is_active` says so. And its dual is 2.3e-12 at 600 and
    5.0e-14 at 10,000, which is the absence of a price rather than a small
    one. Three different questions, three different answers, and only the
    dual answers the one a reader cares about.

    So a reader shown the row's 0.0056 as unused balance sheet would be
    wrong twice: it is not the book's spare capacity, and it is not spare
    at all. The evidence is what happens when the cap is moved. Holding
    everything else fixed and solving at caps of 1.32, 2.0 and 6.0, the row
    reads 1.3144, 1.9796 and 2.0207 at 600 scenarios and 1.3169, 1.9951 and
    2.0752 at 10,000 — while the book's own `sum |w|` is 0.8597 at 600 and
    0.8200 at 10,000 and does not move at all. What the row reports is the
    size of the budget, filled by padding the budget itself invited.

    Note what is asserted and what is only measured. That `sum |w|` is
    unchanged is a statement about the portfolio and holds for any solver
    that finds the optimum, so the test asserts it. How far the padding
    grows is not: at a cap of 6.0 the row stops at 2.0207 at 600 scenarios
    and 2.0752 at 10,000 rather than tracking the cap, because which point
    of a wide optimal face an interior-point method returns is a property
    of the algorithm. So the test asserts only that the row grows when the
    cap does.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=SLACK_TARGET, log=log)
    assert outcome.solution is not None

    rows = {
        row.label: row
        for row in constraint_rows(
            small_scenario, small_market.returns, outcome.solution, target=SLACK_TARGET
        )
    }
    gross_row = rows["gross_leverage"]
    cap = small_scenario.limits.gross_leverage_max

    # Close to the cap...
    assert 0.0 < gross_row.slack < cap / 100.0
    # ...but not on it, at the tolerance the lab actually ships.
    assert not is_active(gross_row, tolerance=small_scenario.tolerances.constraint_abs)
    # ...and worth nothing either way.
    assert abs(outcome.duals["gross_leverage"]) < 1e-9

    portfolio_gross = float(np.abs(outcome.solution.weights).sum())
    for wider in (2.0, 6.0):
        widened = with_limit(small_scenario, "gross_leverage", wider)
        wide_built = build_cvar_problem(widened, small_market, log=log)
        wide_outcome = solve_problem(
            wide_built, algorithm="CLARABEL", target=SLACK_TARGET, log=log
        )
        assert wide_outcome.solution is not None
        wide_rows = {
            row.label: row
            for row in constraint_rows(
                widened,
                small_market.returns,
                wide_outcome.solution,
                target=SLACK_TARGET,
            )
        }
        assert wide_rows["gross_leverage"].left_hand_side > gross_row.left_hand_side
        assert float(np.abs(wide_outcome.solution.weights).sum()) == pytest.approx(
            portfolio_gross, abs=1e-3
        )


def test_pricing_leaves_the_compiled_problem_on_the_target_it_arrived_on(
    small_scenario: Scenario,
    priced_book: tuple[BuiltProblem, tuple[DualRow, ...]],
) -> None:
    """The return target's nudges re-solve the caller's problem, then undo it.

    Both nudged solves run on the compiled problem the caller handed over,
    because that bound is the `cp.Parameter` and rebuilding for it would
    waste the whole point of the parameter. The cost is that they leave the
    problem's variables holding a book nobody asked for, so the table
    restores it.
    """
    built, _ = priced_book
    assert built.target.value == pytest.approx(
        small_scenario.headline_target_monthly, abs=1e-12
    )
    assert built.weights.value is not None


def test_the_table_prices_the_target_that_was_solved_not_the_headline(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """A book solved away from the headline is priced against its own target.

    The sweep solves one compiled problem at twenty-five targets. Pricing
    any of them against the scenario's headline would describe a portfolio
    nobody asked about — and would do it silently, which is the worst shape
    a defect in a table of prices can take.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=SLACK_TARGET, log=log)
    rows = {
        row.label: row
        for row in build_dual_table(
            small_scenario, small_market, built, outcome, log=log
        )
    }
    # The return constraint has slack at 0.002, so it is inactive and
    # priceless — which it would not be if the table had used the 0.008
    # headline, where it binds.
    assert rows["return_target"].active is False
    assert rows["return_target"].finite_difference is None


def test_a_solve_with_no_weights_cannot_be_priced(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """An unreachable target leaves a Farkas certificate, not a shadow price.

    CVXPY does leave dual values on the constraints of an infeasible
    solve. They are real numbers and they mean something — they certify
    that no book exists — but they are not the price of anything, so the
    table refuses rather than printing them.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(built, algorithm="CLARABEL", target=0.05, log=log)
    assert outcome.solution is None

    with pytest.raises(SolveError, match="no weights"):
        build_dual_table(small_scenario, small_market, built, outcome, log=log)


def test_a_label_with_no_desk_limit_field_cannot_be_rebuilt(
    small_scenario: Scenario,
) -> None:
    """`return_target` is a parameter, not a mandate field, and says so."""
    with pytest.raises(SolveError, match="return_target"):
        with_limit(small_scenario, "return_target", 0.01)


def test_moving_one_limit_leaves_the_rest_of_the_mandate_alone(
    small_scenario: Scenario,
) -> None:
    """A nudged mandate differs in exactly one field."""
    nudged = with_limit(small_scenario, "turnover_budget", 0.75)
    assert nudged.limits.turnover_max == 0.75
    assert nudged.limits == replace(small_scenario.limits, turnover_max=0.75)
    assert nudged.universe is small_scenario.universe


def test_the_nudge_is_relative_with_an_absolute_floor() -> None:
    """A step sized to the bound, and a step at all for a bound of zero."""
    assert nudge_step(1.32) == pytest.approx(1.32e-4)
    assert nudge_step(-0.02) == pytest.approx(2e-6)
    assert nudge_step(0.0) == pytest.approx(1e-6)


def test_a_price_of_the_right_size_and_the_wrong_sign_is_refused() -> None:
    """The agreement test is a check on direction as much as on magnitude.

    Switched off on its own, without solving anything: a measured slope of
    the right size and the opposite sign fails, and the same magnitude with
    the correct sign passes. A dual read off the wrong constraint, or a
    constraint whose sense was written backwards, produces exactly the
    first case — and a comparison of absolute values would wave it through.
    """
    ceiling = ConstraintRow(
        label="gross_leverage",
        left_hand_side=1.32,
        right_hand_side=1.32,
        slack=0.0,
        rhs_slope_sign=-1.0,
    )
    assert agrees(ceiling, dual=8.349e-03, measured=-8.349e-03, tolerance=0.02)
    assert not agrees(ceiling, dual=8.349e-03, measured=8.349e-03, tolerance=0.02)

    floor = ConstraintRow(
        label="return_target",
        left_hand_side=0.008,
        right_hand_side=0.008,
        slack=0.0,
        rhs_slope_sign=1.0,
    )
    assert agrees(floor, dual=4.186, measured=4.186, tolerance=0.02)
    assert not agrees(floor, dual=4.186, measured=-4.186, tolerance=0.02)


def test_a_nudge_that_cannot_be_solved_is_reported_as_unverifiable(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unsolvable re-solve leaves the row in the table saying so.

    Dropping the row would leave a table that silently answers a smaller
    question than it appears to, so the price is reported with no
    difference beside it and `agrees` false — which `console.py` prints as
    "not verifiable at this point" rather than as a failed check.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=small_scenario.headline_target_monthly,
        log=log,
    )
    assert outcome.solution is not None

    def refuses(*_args: object, **_kwargs: object) -> SolveOutcome:
        """Stand in for a nudged bound the mandate cannot satisfy."""
        return replace(outcome, status="infeasible", solution=None, duals={})

    monkeypatch.setattr(duals_check, "solve_problem", refuses)
    rows = build_dual_table(small_scenario, small_market, built, outcome, log=log)

    active = [row for row in rows if row.active]
    assert active
    for row in active:
        assert row.finite_difference is None
        assert row.agrees is False


def test_a_label_the_solver_never_priced_is_refused_not_zeroed(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """A missing price is an error, not a price of zero.

    `solver.py` omits any constraint the solver left no dual on, which is
    a real possibility rather than a defensive one: a presolve can remove
    a row, and a method can decline to form the dual at all. Defaulting
    the gap to 0.0 would print "this limit costs nothing" about a limit
    whose price was never reported — and on an active row that is a wrong
    answer wearing the costume of a right one, with nothing on screen to
    tell a reader which it is.
    """
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=small_scenario.headline_target_monthly,
        log=log,
    )
    assert "turnover_budget" in outcome.duals
    blinded = replace(
        outcome,
        duals={
            label: value
            for label, value in outcome.duals.items()
            if label != "turnover_budget"
        },
    )

    with pytest.raises(SolveError, match="turnover_budget"):
        build_dual_table(small_scenario, small_market, built, blinded, log=log)


def test_a_failed_restore_does_not_replace_the_failure_that_caused_it(
    small_scenario: Scenario,
    small_market: MarketScenarios,
    log: Logger,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The diagnosis a caller needs is the first failure, not the cleanup's.

    The restore runs while an exception is already on its way out, and it
    solves, so it can fail on its own account. Letting it raise there
    would swap a real diagnosis for a downstream one — and the downstream
    one always looks like a solver problem, which is the least useful
    place to send someone.
    """

    def original_failure(*_args: object, **_kwargs: object) -> float:
        raise SolveError("the original failure")

    def restore_failure(*_args: object, **_kwargs: object) -> SolveOutcome:
        raise SolveError("the restore failure")

    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=small_scenario.headline_target_monthly,
        log=log,
    )
    monkeypatch.setattr(duals, "finite_difference", original_failure)
    monkeypatch.setattr(duals, "solve_problem", restore_failure)

    with pytest.raises(SolveError, match="the original failure"):
        build_dual_table(small_scenario, small_market, built, outcome, log=log)
