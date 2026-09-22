"""Where each priced constraint's left-hand side actually lives.

A shadow price only means something on a constraint that is *active* — one
the optimum is pressed right up against. Deciding that is the whole job of
this module, and it is a place the lab has been wrong before, so the rule
is written down here and nowhere else:

**A constraint's slack is measured on the constraint's own left-hand side,
never on a proxy.** `gross_leverage` is written on `sum(l + s)`, not on
`sum |w|`. Those two agree only where the signed split is exact, and they
diverge precisely where it is not — which is the bottom of the frontier.
Measured at the shipped 10,000 scenarios and a 0.002 target, the book's own
`sum |w|` is 0.8200 while `sum(l + s)` is 1.3169 against a 1.32 cap: a test
reading the first would call the cap comfortably slack while the row the
solver sees has three thousandths of room.

The turnover budget is written on `sum(t)` for the same kind of reason, and
it is worth saying exactly how far that goes at the shipped settings. There
the budget binds at every target measured, which pushes `t` down onto the
real trade: the gap between `sum(t)` and the recomputed `sum |w - w0|` is
9.1e-11 at 600 scenarios and 3.0e-12 at 10,000, at the 0.008 headline. So
the two coincide *today* — which is precisely the kind of agreement that
turns false the moment an edit moves the book, and it passes every check
that verifies numbers while it lasts.

Take both of `t`'s premises away and it floats free. The arm, with every
other term pinned: the shipped mandate, both costs on, `turnover_max`
widened 0.50 -> 8.0 so the budget is slack — 6.06 of room at 600
scenarios and 6.64 at 10,000 — and the return target set to -0.02, where
the return constraint has 1.70e-02 of slack at 600 and 1.72e-02 at 10,000
so the half-spread charges for nothing. There
`sum(t)` sits 6.2e-01 above the real trade at 600 scenarios and 4.3e-02
above it at 10,000. The row is measured on `t` because that is what the
constraint says, not because the two happen to differ today.

Only the beta band is written on `w` itself.

So every expression below is rebuilt from the *solver's own legs*, and this
module never reaches for `VerificationReport`, whose exposures are
portfolio quantities by design and answer a different question.

**Closeness is not activity, and neither is scarcity.** At that same
10,000-scenario 0.002 target the gross row has 0.0031 of slack against a
1.32 cap — a quarter of a percent of it, which reads like a limit about to
bite. Under the shipped `constraint_abs` of 1e-7 it is *inactive*, and
`is_active` returns False for it. Its dual is 5.0e-14, which is the
absence of a price rather than a small one. Three questions with three
answers, and a reader who conflates the first with the third gets the
mandate exactly backwards.

The reason the row is so close is that an interior point parks free
padding against whatever budget it is given. Move the cap and the row
moves with it while the portfolio does not: caps of 1.32, 2.0 and 6.0 give
a row reading 1.3169, 1.9951 and 2.0752 while the book's own `sum |w|`
stays at 0.8200 in all three. So a reader shown that 0.0031 as spare
balance sheet would be reading the size of the budget, not the size of
anything the book could use. That is why `ConstraintRow` reports the
measurement and leaves the verdict to the dual — the number that says
whether a limit is scarce.

This file runs past the ~200-line target the lab holds its modules to on
prose alone: about 90 lines are executable and the rest is the rule above,
which is the one this lab has spent the most effort getting right. It is
written beside the five expressions it governs on purpose — moving the
reasoning away from the rows it justifies is exactly how the rule came to
be broken in the first place.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from app.contracts import FloatArray, PortfolioSolution, Scenario
from app.errors import SolveError
from app.model_desk import DUAL_BEARING_LABELS, MONTHS_PER_YEAR, sample_mean

RETURN_TARGET_LABEL = "return_target"

# The `DeskLimits` field each label's bound is baked into. `return_target`
# is absent on purpose: its right-hand side is the `cp.Parameter` the whole
# lab sweeps, so nudging it needs no rebuild and no replaced mandate.
LIMIT_FIELDS = {
    "gross_leverage": "gross_leverage_max",
    "turnover_budget": "turnover_max",
    "beta_upper": "beta_max",
    "beta_lower": "beta_min",
}

# The smallest nudge used for a finite difference, for a bound at or near
# zero where a relative step would vanish.
MINIMUM_NUDGE = 1e-6

# The relative size of the nudge everywhere else.
NUDGE_FRACTION = 1e-4


@dataclass(frozen=True)
class ConstraintRow:
    """One priced constraint, measured on the expression it is written on.

    `slack` is signed the feasible way round: positive means the optimum
    has room against the bound, zero means the row is active, and a small
    negative value is the solver's own tolerance showing through.

    `rhs_slope_sign` is the sign of `d(objective) / d(right_hand_side)`
    that the constraint's sense implies. Relaxing a `<=` bound can only
    lower the objective of a minimization, so those rows carry `-1.0`;
    raising the floor of a `>=` bound can only raise it, so those carry
    `+1.0`. CVXPY reports a nonnegative dual for either sense — it is the
    rate at which the objective worsens as the constraint tightens — so
    this sign is what turns the reported dual into a predicted slope that
    a finite difference can be compared against.
    """

    label: str
    left_hand_side: float
    right_hand_side: float
    slack: float
    rhs_slope_sign: float


def _expected_net_return(
    scenario: Scenario, returns: FloatArray, solution: PortfolioSolution
) -> float:
    """Rebuild the return constraint's left-hand side, legs and all.

    This is the model's expression, not the book's honest cost: borrow is
    charged on the solver's `short_leg` and the half-spread on its
    `turnover_leg`, exactly as `model_desk.py` writes them. The verifier
    recomputes the same quantity from the weights alone and gets a
    slightly *better* number wherever a relaxation has lapsed; that gap is
    the thing the verifier exists to measure, and using its version here
    would measure the wrong row.
    """
    universe = scenario.universe
    monthly_borrow = universe.borrow_fee_annual / MONTHS_PER_YEAR
    return float(
        sample_mean(returns) @ solution.weights
        - monthly_borrow @ solution.short_leg
        - universe.half_spread @ solution.turnover_leg
    )


def _at_most(label: str, left: float, right: float) -> ConstraintRow:
    """Build the row for a `left <= right` constraint."""
    return ConstraintRow(
        label=label,
        left_hand_side=left,
        right_hand_side=right,
        slack=right - left,
        rhs_slope_sign=-1.0,
    )


def _at_least(label: str, left: float, right: float) -> ConstraintRow:
    """Build the row for a `left >= right` constraint."""
    return ConstraintRow(
        label=label,
        left_hand_side=left,
        right_hand_side=right,
        slack=left - right,
        rhs_slope_sign=1.0,
    )


def constraint_rows(
    scenario: Scenario,
    returns: FloatArray,
    solution: PortfolioSolution,
    *,
    target: float,
) -> tuple[ConstraintRow, ...]:
    """Measure every priced constraint on its own left-hand side.

    Args:
        scenario: The universe and the desk mandate the book was solved on.
        returns: The `[S, N]` matrix the model's sample mean comes from.
        solution: The solved weights *and legs*. The legs are load-bearing:
            three of the five rows are written on them.
        target: The return target actually solved, which is the
            right-hand side of the `return_target` row.

    Returns:
        One row per label in `model_desk.DUAL_BEARING_LABELS`, in that
        order.
    """
    limits, universe = scenario.limits, scenario.universe
    beta_exposure = float(universe.market_beta @ solution.weights)
    rows = {
        RETURN_TARGET_LABEL: _at_least(
            RETURN_TARGET_LABEL,
            _expected_net_return(scenario, returns, solution),
            target,
        ),
        "gross_leverage": _at_most(
            "gross_leverage",
            float(np.sum(solution.long_leg + solution.short_leg)),
            limits.gross_leverage_max,
        ),
        "turnover_budget": _at_most(
            "turnover_budget",
            float(np.sum(solution.turnover_leg)),
            limits.turnover_max,
        ),
        "beta_upper": _at_most("beta_upper", beta_exposure, limits.beta_max),
        "beta_lower": _at_least("beta_lower", beta_exposure, limits.beta_min),
    }
    return tuple(rows[label] for label in DUAL_BEARING_LABELS)


def is_active(row: ConstraintRow, *, tolerance: float) -> bool:
    """Is the optimum pressed against this bound, within `tolerance`?

    Active means no slack, and nothing more — it does not mean the
    constraint is scarce, and *near* no slack is not active at all. At the
    shipped `constraint_abs` of 1e-7 the gross row at a 0.002 target is
    0.0031 from its cap at 10,000 scenarios and comes back False here,
    with a dual of 5.0e-14 agreeing. A caller tempted to pass a looser
    tolerance so that such a row reads as active would be inventing a
    price the program never charged.
    """
    return row.slack <= tolerance


def nudge_step(right_hand_side: float) -> float:
    """Return the finite-difference step for a bound of this size.

    Relative to the bound so the step is meaningful at 1.32 of NAV and at
    0.008 of monthly return alike, with an absolute floor for a bound at
    zero, where a relative step would be no step at all.
    """
    return max(MINIMUM_NUDGE, NUDGE_FRACTION * abs(right_hand_side))


def with_limit(scenario: Scenario, label: str, value: float) -> Scenario:
    """Return the same scenario with one desk limit moved.

    The mandate is rebuilt by `dataclasses.replace` rather than reloaded,
    which deliberately bypasses `validate_scenario`: a nudged bound is a
    probe of the program, not a mandate anyone is asked to trade under, and
    the shipped gross cap sits exactly on the starting book's own gross, so
    the loader would rightly refuse a downward nudge of it.

    Raises:
        SolveError: If `label` has no `DeskLimits` field — which is true
            of `return_target`, whose bound is a `cp.Parameter` and must be
            nudged there instead.
    """
    field = LIMIT_FIELDS.get(label)
    if field is None:
        raise SolveError(
            f"{label!r} has no desk-limit field to move; this lab can rebuild "
            f"{', '.join(sorted(LIMIT_FIELDS))}"
        )
    return replace(scenario, limits=replace(scenario.limits, **{field: value}))
