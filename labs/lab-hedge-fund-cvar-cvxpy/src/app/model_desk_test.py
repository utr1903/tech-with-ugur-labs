"""The two relaxations' exactness premises, pinned by experiment.

`model_desk.py` declares two constraint families that are relaxations
rather than definitions — the signed split `w = l - s` and the turnover
bound `t >= |w - w0|` — and argues in each case that an optimum collapses
them onto the thing they are standing in for. Both arguments are
conditional, and the conditions are easy to state loosely: the two costs
look interchangeable, and "the costs are positive" looks like it ought to
be enough on its own. Neither is true.

So the premises are not left as prose. The table below switches each term
off on its own and records what actually happens, which is the only way to
tell a term that *causes* an effect from one that merely accompanies it.
Every arm runs on the shipped 30-name mandate at the 600-scenario sample
the tests use, and every arm asserts its own premise state — that the cap
it needs slack really is slack, that the target it calls binding really
does bind — so an arm cannot quietly stop testing what it claims to.

What the table establishes, and what `model_desk.py`'s comments must agree
with:

    the signed split is exact  <=>  a gross cap binds
                                     OR (borrow fee > 0 AND target binds)

    the turnover bound is exact <=>  the turnover budget binds
                                     OR (half-spread > 0 AND target binds)

The two costs do not swap roles, and neither is sufficient alone. The
borrow fee is charged on `s`, so it prices the padding in the split and
nothing in the turnover leg. The half-spread is charged on `t`, which is
pinned from below by `w` and `w0` alone, so padding `(l, s)` cannot move
it and the spread prices nothing there. And because both costs sit in the
expected-net-return constraint rather than in the objective, neither
charges anything at all while that constraint has slack.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pytest

from app.contracts import MarketScenarios, Scenario, frozen_float_array
from app.logging_setup import Logger
from app.model import build_cvar_problem
from app.solver import solve_problem
from app.verification import relaxation_overlap
from app.verification_exposures import cost_ledger

# A lapsed relaxation is four orders of magnitude clear of an exact one on
# every arm below — the closest pair is 2.0e-09 against 1.1e-02 — so the
# two bands are separated rather than adjacent and nothing here rests on a
# borderline call.
LAPSE_FACTOR = 1_000


@dataclass(frozen=True)
class PremiseArm:
    """One switch setting, its premise state, and what it does to each bound.

    The three `*_binds` fields are not inputs. They are what the arm claims
    the solved book will look like, and the test asserts them before it
    looks at any overlap — so an arm whose premises stopped holding fails
    as a wrong premise rather than silently testing something else.
    """

    name: str
    borrow_fee: bool
    half_spread: bool
    gross_leverage_max: float
    turnover_max: float
    target: float
    gross_cap_binds: bool
    turnover_budget_binds: bool
    return_target_binds: bool
    split_exact: bool
    turnover_exact: bool


# Measured at 600 scenarios, seed 20260920. The `overlap` and `padding`
# columns in the comments are what this table was read off; they are
# recorded for a reader's orientation and are not asserted as values.
PREMISE_ARMS = (
    # --- the signed split: the turnover budget is left binding throughout,
    # so the turnover bound stays exact and the split is the only thing
    # moving. Every gross cap is slack, so premise one is switched off.
    PremiseArm(  # overlap 1.7e-09
        name="both costs, target binding",
        borrow_fee=True,
        half_spread=True,
        gross_leverage_max=1.32,
        turnover_max=0.50,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=True,
        return_target_binds=True,
        split_exact=True,
        turnover_exact=True,
    ),
    PremiseArm(  # overlap 2.0e-09 — the borrow fee alone is enough
        name="borrow fee only, target binding",
        borrow_fee=True,
        half_spread=False,
        gross_leverage_max=1.32,
        turnover_max=0.50,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=True,
        return_target_binds=True,
        split_exact=True,
        turnover_exact=True,
    ),
    PremiseArm(  # overlap 1.1e-02 — the half-spread alone is not
        name="half-spread only, target binding",
        borrow_fee=False,
        half_spread=True,
        gross_leverage_max=1.32,
        turnover_max=0.50,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=True,
        return_target_binds=True,
        split_exact=False,
        turnover_exact=True,
    ),
    PremiseArm(  # overlap 1.2e-02
        name="no costs, target binding",
        borrow_fee=False,
        half_spread=False,
        gross_leverage_max=1.32,
        turnover_max=0.50,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=True,
        return_target_binds=True,
        split_exact=False,
        turnover_exact=True,
    ),
    PremiseArm(  # overlap 1.2e-02 — costs on, but charging nothing
        name="both costs, target slack",
        borrow_fee=True,
        half_spread=True,
        gross_leverage_max=1.32,
        turnover_max=0.50,
        target=-0.02,
        gross_cap_binds=False,
        turnover_budget_binds=True,
        return_target_binds=False,
        split_exact=False,
        turnover_exact=True,
    ),
    PremiseArm(  # overlap 1.2e-10 — premise one on its own, no costs at all
        name="no costs, gross cap binding",
        borrow_fee=False,
        half_spread=False,
        gross_leverage_max=1.00,
        turnover_max=0.50,
        target=0.008,
        gross_cap_binds=True,
        turnover_budget_binds=True,
        return_target_binds=True,
        split_exact=True,
        turnover_exact=True,
    ),
    # --- the turnover bound: the budget is widened until it is slack, so
    # premise one of *that* argument is switched off and the half-spread is
    # the only thing left that can pin `t` down.
    PremiseArm(  # padding 1.3e-10
        name="budget slack, both costs, target binding",
        borrow_fee=True,
        half_spread=True,
        gross_leverage_max=1.32,
        turnover_max=8.00,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=False,
        return_target_binds=True,
        split_exact=True,
        turnover_exact=True,
    ),
    PremiseArm(  # padding 4.6e-02 — the borrow fee cannot pin `t`
        name="budget slack, borrow fee only, target binding",
        borrow_fee=True,
        half_spread=False,
        gross_leverage_max=1.32,
        turnover_max=8.00,
        target=0.006,
        gross_cap_binds=False,
        turnover_budget_binds=False,
        return_target_binds=True,
        split_exact=True,
        turnover_exact=False,
    ),
    PremiseArm(  # padding 4.3e-02 — spread on, but charging nothing
        name="budget slack, both costs, target slack",
        borrow_fee=True,
        half_spread=True,
        gross_leverage_max=1.32,
        turnover_max=8.00,
        target=-0.02,
        gross_cap_binds=False,
        turnover_budget_binds=False,
        return_target_binds=False,
        split_exact=False,
        turnover_exact=False,
    ),
)


def _scenario_for(arm: PremiseArm, scenario: Scenario) -> Scenario:
    """Apply one arm's switch settings to the shipped mandate."""
    zero = frozen_float_array(np.zeros(len(scenario.universe.names)))
    universe = replace(
        scenario.universe,
        borrow_fee_annual=scenario.universe.borrow_fee_annual
        if arm.borrow_fee
        else zero,
        half_spread=scenario.universe.half_spread if arm.half_spread else zero,
    )
    limits = replace(
        scenario.limits,
        gross_leverage_max=arm.gross_leverage_max,
        turnover_max=arm.turnover_max,
    )
    return replace(scenario, universe=universe, limits=limits)


@pytest.mark.parametrize("arm", PREMISE_ARMS, ids=lambda arm: arm.name)
def test_each_relaxation_is_exact_exactly_when_its_premises_hold(
    arm: PremiseArm,
    small_scenario: Scenario,
    small_market: MarketScenarios,
    log: Logger,
) -> None:
    """Switch one term off at a time and record which bound stops collapsing.

    A comment claiming that some term in the model causes some behaviour is
    checked by switching that term off on its own and confirming the
    behaviour goes away. Measuring the shipped scenario can never do that,
    because there every term is switched on at once and the effects are
    indistinguishable.
    """
    scenario = _scenario_for(arm, small_scenario)
    universe, limits = scenario.universe, scenario.limits
    tolerance = scenario.tolerances.relaxation_abs

    outcome = solve_problem(
        build_cvar_problem(scenario, small_market, log=log),
        algorithm="CLARABEL",
        target=arm.target,
        log=log,
    )
    assert outcome.solution is not None, f"{arm.name}: {outcome.status}"
    solution = outcome.solution
    weights = solution.weights
    traded = np.abs(weights - universe.start_book)

    # The premise state the arm claims, checked before anything is read off
    # the legs. Without this an arm could drift into testing a different
    # experiment and still pass.
    assert universe.borrow_fee_annual.any() == arm.borrow_fee
    assert universe.half_spread.any() == arm.half_spread
    gross_slack = limits.gross_leverage_max - float(np.abs(weights).sum())
    budget_slack = limits.turnover_max - float(traded.sum())
    target_slack = (
        cost_ledger(universe, small_market.returns, weights).expected_net_return
        - arm.target
    )
    assert (gross_slack <= tolerance) == arm.gross_cap_binds
    assert (budget_slack <= tolerance) == arm.turnover_budget_binds
    assert (target_slack <= tolerance) == arm.return_target_binds
    # The per-name and per-sector gross caps are written on `l + s` just as
    # the gross-leverage cap is, so an arm that claims no cap binds has to
    # clear those two as well.
    assert float(np.abs(weights).max()) < limits.name_gross_cap - tolerance
    assert float((universe.sector_matrix @ np.abs(weights)).max()) < (
        limits.sector_gross_cap - tolerance
    )

    overlap = relaxation_overlap(solution.long_leg, solution.short_leg)
    padding = float((solution.turnover_leg - traded).max())

    if arm.split_exact:
        assert overlap <= tolerance
    else:
        assert overlap > LAPSE_FACTOR * tolerance
    if arm.turnover_exact:
        assert padding <= tolerance
    else:
        assert padding > LAPSE_FACTOR * tolerance


def test_the_two_costs_do_not_swap_roles() -> None:
    """The table above has to contain the experiment that separates them.

    This is a guard on the arm table rather than on the model. The whole
    point of the table is that switching the borrow fee off breaks the
    split while leaving the turnover bound alone, and switching the
    half-spread off does the mirror image. If a future edit dropped either
    arm, the remaining ones would still pass while proving much less.
    """
    by_name = {arm.name: arm for arm in PREMISE_ARMS}

    spread_alone = by_name["half-spread only, target binding"]
    assert not spread_alone.split_exact
    assert spread_alone.turnover_exact

    borrow_alone = by_name["budget slack, borrow fee only, target binding"]
    assert borrow_alone.split_exact
    assert not borrow_alone.turnover_exact


def test_a_binding_cap_or_budget_is_sufficient_without_any_cost() -> None:
    """Premise one of each argument stands on its own, with both costs off."""
    by_name = {arm.name: arm for arm in PREMISE_ARMS}

    capped = by_name["no costs, gross cap binding"]
    assert not capped.borrow_fee
    assert not capped.half_spread
    assert capped.gross_cap_binds
    assert capped.split_exact

    # Every arm that leaves the turnover budget binding keeps the turnover
    # bound exact, whatever the costs are doing.
    budgeted = [arm for arm in PREMISE_ARMS if arm.turnover_budget_binds]
    assert len(budgeted) >= 4
    assert all(arm.turnover_exact for arm in budgeted)
