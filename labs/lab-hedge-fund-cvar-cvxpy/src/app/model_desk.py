"""The decision variables and the desk mandate, shared by every model here.

The lab compares three programs — the Rockafellar-Uryasev linear program,
a mean-variance control and an atom oracle — and the comparison is only
worth anything if all three answer the *same* question. So the variables
and the whole feasible set are built once, here, and the three builders in
`model.py` differ by their objective and nothing else. There is no second
copy of the mandate to drift out of step with this one.

Two of the constraint families below are relaxations rather than
definitions, and each one's exactness argument is written out at the line
that introduces it: the signed split `w = l - s` and the turnover bound
`t >= |w - w0|`. Those two arguments are subtler than they look — the
premises are different for each, and the half-spread disciplines one and
not the other — so they are written out in full where the constraints are
declared.

That is also why this file runs past the ~200-line target the lab holds
its modules to: more of it is prose than code. The mandate is one
dictionary a reader should be able to read top to bottom in one place,
with each relaxation's reasoning beside the row it justifies.

Neither argument is left to the prose alone. `model_desk_test.py` switches
each term off on its own — borrow fee, half-spread, the caps, the turnover
budget, the return target's slack — and asserts which bound collapses in
each case. It also writes the two rules below out as code and asserts they
predict every arm, so the chain runs from rule to expected outcome to
solve. The claims below are read off that table, and a comment here cannot
drift away from the mathematics without turning a test red.

Read the cap conditions carefully in one respect: the three gross caps are
written on `l + s`, not on `|w|`, and those agree only where the split is
exact. Where it is padded they part company badly, so anything asking
whether a cap is active has to evaluate `l + s`.
"""

from __future__ import annotations

from dataclasses import dataclass

import cvxpy as cp
import numpy as np

from app.contracts import FloatArray, Scenario
from app.errors import ModelError

# Borrow is quoted as an annual rate and the horizon is one month, so the
# cost charged on short notional is the annual rate over twelve.
MONTHS_PER_YEAR = 12.0

# The constraints whose shadow prices the lab reports. They are the four
# limits a portfolio manager actually negotiates — how much return is being
# demanded, how much balance sheet, how much trading, and how much market
# direction — so their duals are the ones worth a dollar interpretation.
DUAL_BEARING_LABELS = (
    "return_target",
    "gross_leverage",
    "turnover_budget",
    "beta_upper",
    "beta_lower",
)


@dataclass(frozen=True, eq=False)
class DeskVariables:
    """The four vectors every model in this lab decides over.

    `eq=False` throughout this lab's CVXPY-holding dataclasses: `==` on a
    CVXPY variable builds a constraint rather than answering a question, so
    a generated `__eq__` would silently do something other than compare.
    Identity is the only equality these ever need.
    """

    weights: cp.Variable
    long_leg: cp.Variable
    short_leg: cp.Variable
    turnover_leg: cp.Variable


@dataclass(frozen=True, eq=False)
class DeskBlock:
    """The shared half of a model: variables, return target and constraints.

    `families` holds every constraint keyed by a readable label, in the
    order they are declared; `labelled` is the dual-bearing subset. Both
    dictionaries hold the *same* constraint objects, so a dual read off
    `labelled` belongs to the constraint that went into the problem.
    """

    variables: DeskVariables
    target: cp.Parameter
    families: dict[str, cp.Constraint]
    labelled: dict[str, cp.Constraint]


def variable_list(variables: DeskVariables) -> list[cp.Variable]:
    """Return the shared decision vectors in declaration order."""
    return [
        variables.weights,
        variables.long_leg,
        variables.short_leg,
        variables.turnover_leg,
    ]


def sample_mean(returns: FloatArray) -> FloatArray:
    """Return the per-name mean of the matrix the model will optimize on.

    This — not the universe's `expected_return` — is what the return-target
    constraint uses. The generator's expected return is what the scenarios
    were *drawn to have*; this is what they actually came out with. Holding
    the model to the second means the optimizer can never be right about a
    portfolio the scenario matrix disagrees with. The two are reported side
    by side so the sampling gap between them stays visible.
    """
    mean: FloatArray = returns.mean(axis=0)
    return mean


def sample_covariance(returns: FloatArray) -> FloatArray:
    """Return the symmetrized sample covariance of a `[S, N]` matrix.

    A sample covariance is symmetric in exact arithmetic and very nearly
    symmetric in floating point; symmetrizing it costs nothing and removes
    the asymmetry CVXPY would otherwise reject. Kept here beside the sample
    mean, and importable without CVXPY, so the verification pass can
    recompute the variance objective from the weights alone.
    """
    covariance: FloatArray = np.cov(returns, rowvar=False)
    symmetric: FloatArray = (covariance + covariance.T) / 2.0
    return symmetric


def require_usable_returns(scenario: Scenario, returns: FloatArray) -> FloatArray:
    """Check a return matrix can be projected onto this universe.

    Raises:
        ModelError: If `returns` is not a `[S, N]` matrix whose columns
            match the universe, or holds fewer than two scenarios.
    """
    name_count = len(scenario.universe.names)
    if returns.ndim != 2:
        raise ModelError(f"returns must be a 2-D [S, N] matrix, got {returns.shape}")
    if returns.shape[1] != name_count:
        raise ModelError(
            f"returns must have one column per universe name; the universe has "
            f"{name_count} names and the matrix is {returns.shape}"
        )
    if returns.shape[0] < 2:
        raise ModelError(
            f"at least two scenarios are needed to build a model, "
            f"got {returns.shape[0]}"
        )
    return returns


def desk_variables(name_count: int) -> DeskVariables:
    """Declare the shared decision vectors.

    `weights` is free, because a name may be held long or short. The other
    three are declared nonnegative on the variable itself rather than as
    explicit rows, which is why `problem.constraints` contains only the
    mandate below and not `l >= 0`.
    """
    return DeskVariables(
        weights=cp.Variable(name_count, name="weights"),
        long_leg=cp.Variable(name_count, name="long_leg", nonneg=True),
        short_leg=cp.Variable(name_count, name="short_leg", nonneg=True),
        turnover_leg=cp.Variable(name_count, name="turnover_leg", nonneg=True),
    )


def desk_block(scenario: Scenario, returns: FloatArray) -> DeskBlock:
    """Build the variables, the return-target parameter and the mandate."""
    universe, limits = scenario.universe, scenario.limits
    variables = desk_variables(len(universe.names))
    weights = variables.weights
    long_leg, short_leg = variables.long_leg, variables.short_leg
    turnover_leg = variables.turnover_leg

    # A parameter, not a constant, so the frontier sweep compiles this
    # problem once and re-solves it at every target on the grid.
    target = cp.Parameter(name="return_target")

    monthly_borrow = universe.borrow_fee_annual / MONTHS_PER_YEAR
    expected_net = (
        sample_mean(returns) @ weights
        - monthly_borrow @ short_leg
        - universe.half_spread @ turnover_leg
    )

    families: dict[str, cp.Constraint] = {
        # The signed split. Nothing here forbids a name from carrying a
        # long leg and a short leg at the same time, so `l + s` is only an
        # upper bound on `|w|` — which is why this is a relaxation and not
        # a definition. It is exact at an optimum whenever inflating both
        # legs together is strictly worse, and exactly two things can make
        # it so:
        #
        #   1. a binding gross-leverage, per-name or per-sector cap —
        #      all three are written on `l + s`, so an inflated pair
        #      spends budget the position could have used;
        #   2. a binding return target *together with* a positive borrow
        #      fee, because the fee is charged on `s` and an inflated pair
        #      therefore eats return the book has to deliver.
        #
        # Note what is NOT a premise, because it is the easy mistake. The
        # half-spread does not discipline this split at all. It multiplies
        # `turnover_leg`, and `turnover_leg` is pinned from below by `w`
        # and `start_book` alone, through the two turnover rows further
        # down. Padding `(l, s)` leaves `w` untouched, so it leaves `t`
        # untouched, so the spread charges nothing for it. Measured at 600
        # scenarios and a 0.006 target, with every gross cap slack and the
        # turnover budget left binding in all four arms — that last part
        # matters, because it is what holds the turnover leg exact
        # throughout and keeps the split the only thing moving: both costs
        # give an overlap of 1.7e-09, the borrow fee alone 2.0e-09 — and
        # the half-spread alone 1.1e-02, no better than charging nothing.
        #
        # Nor is "the costs are positive" a premise on its own. Both costs
        # live in the return constraint and never in the objective, so
        # while that constraint has slack they charge for nothing at all:
        # padding spends return the book does not need and leaves the tail
        # loss untouched. At 600 scenarios the split is padded by 1.2e-02
        # at a 0.002 target, where the book earns 0.0049; by 1.7e-09 at
        # 0.006 where the target binds. At 10,000 the same 0.002 target
        # pads by 1.3e-02 on a book earning 0.0037. The low-return end of
        # the frontier is genuinely a region where this relaxation lapses.
        #
        # Do not reach for `sum |w|` to check that premise 1 is off in
        # those runs — that is the trap this whole argument is about. The
        # book runs 0.86 of NAV gross at 600 and 0.82 at 10,000, but
        # `sum(l + s)`, which is what the cap constrains, sits at 1.3144
        # and 1.3169 of 1.32: the row is pressed right against the cap by
        # the padding itself. What shows the cap is not the binding
        # premise is its dual, 2.3e-12 and 5.0e-14 — a constraint that
        # costs nothing is not the one holding the answer in place.
        #
        # Take every premise away at once and the guarantee lapses on a
        # book with nothing else wrong with it, which the lab demonstrates
        # rather than asserts. The degenerate fixture in `conftest.py`
        # zeroes every borrow fee and widens every gross budget past
        # anything the book uses; on that mandate the optimal face of the
        # program holds a whole set of `(l, s)` pairs differing only in
        # padding, and Clarabel returns one padded by 0.094 of NAV on the
        # worst name, measured at 600 scenarios. Put the premises back and
        # the same solver on the same 600-scenario sample pads by 1.1e-10,
        # and by exactly nothing at the shipped 10,000.
        #
        # Note what the fixture does *not* prove: HiGHS's simplex, solving
        # that same degenerate program, finishes at a vertex with no
        # padding at all. Which point of an optimal face comes back is a
        # property of the algorithm, not a theorem — so the padding is a
        # thing to measure, and `verification.py` measures
        # `max_i min(l_i, s_i)` on every solved book instead of assuming
        # it away.
        "signed_split": weights == long_leg - short_leg,
        "name_gross_cap": long_leg + short_leg <= limits.name_gross_cap,
        "net_exposure_max": cp.sum(weights) <= limits.net_exposure_max,
        "net_exposure_min": cp.sum(weights) >= limits.net_exposure_min,
        "sector_net_upper": universe.sector_matrix @ weights <= limits.sector_net_cap,
        "sector_net_lower": universe.sector_matrix @ weights >= -limits.sector_net_cap,
        "sector_gross_cap": universe.sector_matrix @ (long_leg + short_leg)
        <= limits.sector_gross_cap,
        # The turnover bound: the same shape of relaxation as the signed
        # split above, but with different premises, which is the thing to
        # keep straight. `t` is pinned above `w - w0` and above `w0 - w`,
        # so `t >= |w - w0|`, with equality only where something pushes
        # `t` back down, and they mirror the split's two exactly:
        #
        #   1. a binding turnover budget, which `t` consumes;
        #   2. a positive half-spread *together with* a binding return
        #      target, since the spread is charged on `t` inside that
        #      constraint and nowhere else.
        #
        # Premise 2 carries the same condition as the split's, and for the
        # same reason: the half-spread lives in the return constraint, so
        # while that constraint has slack it charges for nothing and `t` is
        # free to float.
        #
        # WHICH QUANTITY EVERY FIGURE BELOW IS. All of them are
        # `max_i (t_i - |w_i - w0_i|)`, the worst single name's padding,
        # which is the quantity `model_desk_test.py`'s arm table asserts.
        # None of them is `sum(t) - sum|w - w0|`, which is what
        # `duals_constraints.py` quotes for the same experiment and which
        # is larger by one to two orders of magnitude here. The two
        # readings collide numerically — 4.3e-02 is the per-name figure at
        # 600 scenarios *and* the summed figure at 10,000 — so a reader who
        # compares the two files without checking which quantity each names
        # will conclude one of them has the wrong sample count. Neither
        # does. Read the quantity first.
        #
        # THE ARM, with every non-isolated term pinned: the shipped
        # mandate, both costs on, the gross, per-name and per-sector caps
        # left at their shipped values and all three slack, and
        # `turnover_max` widened 0.50 -> 8.00 so the budget has 7.10 of
        # room at 600 scenarios and 7.43 at 10,000. At a binding 0.006
        # target — the return constraint's slack is 3.3e-14 — the worst
        # name's `t` sits 1.3e-10 above its own trade at 600 scenarios and
        # 4.7e-12 at 10,000. At a slack -0.02 target, where the return
        # constraint has 1.70e-02 of room at 600 and 1.72e-02 at 10,000, it
        # sits 4.3e-02 above it at 600 and 4.2e-03 at 10,000 — on a book
        # the slack target has driven all the way to `sum|w| = 0`.
        #
        # What differs is which cost does the work. The half-spread
        # disciplines this bound and not the split — it multiplies `t`,
        # which padding `(l, s)` cannot move, and never touches `l` or `s`.
        # The borrow fee is the mirror image: it charges `s`, so on that
        # same widened budget, at the same binding 0.006 target, switching
        # the spread off alone leaves the worst name's `t` floating 4.6e-02
        # above its trade at 600 scenarios and 1.4e-02 at 10,000. The
        # degenerate fixture takes both premises away at once and an
        # interior-point solve leaves the worst name floating 0.119 of NAV
        # above its trade at 600 scenarios and 0.020 at 10,000. So the lab
        # recomputes `|w - w0|` from the weights and prices the trade off
        # that, rather than trusting `t` to have collapsed onto it.
        "turnover_buys": turnover_leg >= weights - universe.start_book,
        "turnover_sells": turnover_leg >= universe.start_book - weights,
        "return_target": expected_net >= target,
        "gross_leverage": cp.sum(long_leg + short_leg) <= limits.gross_leverage_max,
        "turnover_budget": cp.sum(turnover_leg) <= limits.turnover_max,
        "beta_upper": universe.market_beta @ weights <= limits.beta_max,
        "beta_lower": universe.market_beta @ weights >= limits.beta_min,
    }
    # Selected by label rather than built separately, so the reported dual
    # always belongs to the constraint that went into the problem and the
    # tuple above stays the one place the label set is written down.
    labelled = {label: families[label] for label in DUAL_BEARING_LABELS}
    return DeskBlock(
        variables=variables, target=target, families=families, labelled=labelled
    )
