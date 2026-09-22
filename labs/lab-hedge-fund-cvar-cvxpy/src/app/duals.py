"""What each desk limit costs, and which of those prices mean anything.

Every constraint in the program has a shadow price: the rate at which the
optimal tail loss worsens as that limit is tightened by one unit. CVXPY
hands them over as `constraint.dual_value`, and they are on their face the
most useful numbers the whole lab produces — the return target's dual is
what the desk pays in tail risk for each basis point of required return,
the gross cap's is what a turn of balance sheet is worth, the beta band's
is the price of the neutrality mandate. Turning those into sentences is
`console.py`'s job. Producing the numbers, and saying which of them mean
anything, is this module's.

Three things decide whether a dual means anything, and the lab has been
wrong about each of them at some point.

**A dual is only meaningful where its constraint is active**, and activity
is measured on the constraint's own left-hand side — `l + s` for the gross
caps, `t` for the turnover budget, `w` only for the beta band.
`duals_constraints.py` owns that rule and the measurements behind it.

**Which constraints are active changes with the sample.** At the shipped
10,000 scenarios the live set at the 0.008 headline target is
`return_target`, `gross_leverage`, `beta_upper` and `turnover_budget`; at
the 600 scenarios the tests run on it is `return_target`,
`turnover_budget` and `beta_lower` — the small sample's mean wants a
slightly short-market book where the large one wants a slightly long one,
so the band binds on the opposite side. The active set is therefore
decided per solve and never assumed.

**A near-zero dual is the absence of a price, not a small one.**
`beta_lower` at 10,000 scenarios comes back at 2.06e-14, on a row with
4.0e-02 of room — it is inactive, and that number is what an inactive row
looks like. It is the lab's deliberate example and it is kept rather than
tuned away, because the mistake it guards against is reading machine
epsilon as a cheap constraint.

**And closeness is not activity.** At a 0.002 target the gross row sits
0.0031 from its 1.32 cap at 10,000 scenarios and 0.0056 at 600 — a
fraction of a percent of the cap, which reads like a limit about to bite.
Under the shipped `constraint_abs` of 1e-7 it is inactive at both sizes,
and its dual agrees: 5.0e-14 at 10,000 and 2.3e-12 at 600. Three
questions — how close, whether binding, what it is worth — with three
different answers, and only the last is the one a reader wants.
So the console shows the portfolio's own `sum |w|` beside these prices, and
it is the dual — never a row's remaining slack — that says whether a limit
is scarce.

**Every price is checked by moving its bound and re-solving.**
`duals_check.py` owns that, including the case where the nudged program
cannot be solved. Two re-solves per active row is what makes this table
the costliest thing in the lab per number produced — 3.9 s for its five
rows, four of them active, at the shipped 10,000 scenarios, against 0.14 s
at 600 — and it is why the check runs only on rows that are active.

This file runs a little past the ~200-line target the lab holds its
modules to, and the reason is prose rather than code: about 140 lines are
executable and the rest is the argument above. The two pieces that could
be lifted out already have been — the left-hand sides into
`duals_constraints.py` and the re-solve into `duals_check.py` — and what
is left is one operation boundary and the table it assembles.
"""

from __future__ import annotations

from app.contracts import DualRow, MarketScenarios, Scenario, SolveOutcome
from app.duals_check import agrees, finite_difference
from app.duals_constraints import (
    RETURN_TARGET_LABEL,
    ConstraintRow,
    constraint_rows,
    is_active,
)
from app.errors import SolveError
from app.logging_setup import Logger
from app.model import BuiltProblem
from app.solver import solve_problem


def _solved_target(built: BuiltProblem) -> float:
    """Read back the return target the problem was last solved at.

    Taken from the parameter rather than from the scenario's headline: the
    frontier sweep solves this same compiled problem at twenty-five
    different targets, and pricing one of those books against the headline
    would put numbers in the table that describe a portfolio nobody asked
    about — a wrong answer rather than an error.

    Raises:
        SolveError: If the parameter was never assigned.
    """
    value = built.target.value
    if value is None:
        raise SolveError("the return target parameter carries no value to price")
    return float(value)


def _dual_of(outcome: SolveOutcome, label: str) -> float:
    """Return the solver's reported price for one labelled constraint.

    A missing label is refused rather than defaulted to zero. `solver.py`
    skips any constraint the solver left no dual on — a presolve can
    remove a row, and a method can decline to form the dual at all — so
    the gap is real and not defensive. Filling it with 0.0 would print
    "this limit costs nothing" for a limit whose price was never
    reported, which on an active row is a wrong answer rather than an
    error, and the reader has no way to tell the two apart.

    Raises:
        SolveError: If `label` carries no dual on this outcome.
    """
    price = outcome.duals.get(label)
    if price is None:
        raise SolveError(
            f"{outcome.solver_name} reported no dual for {label!r}; the "
            f"labels it priced were {sorted(outcome.duals)}"
        )
    return price


def _price_row(
    scenario: Scenario,
    market: MarketScenarios,
    built: BuiltProblem,
    row: ConstraintRow,
    *,
    dual: float,
    target: float,
    algorithm: str,
    log: Logger,
) -> DualRow:
    """Turn one measured constraint into a priced, checked table row."""
    active = is_active(row, tolerance=scenario.tolerances.constraint_abs)
    measured = (
        finite_difference(
            scenario, market, built, row, target=target, algorithm=algorithm, log=log
        )
        if active
        else None
    )
    priced = DualRow(
        label=row.label,
        active=active,
        dual_value=dual,
        finite_difference=measured,
        agrees=measured is not None
        and agrees(
            row,
            dual=dual,
            measured=measured,
            tolerance=scenario.tolerances.dual_relative,
        ),
    )
    log.info(
        "Priced one constraint.",
        label=row.label,
        active=active,
        left_hand_side=row.left_hand_side,
        right_hand_side=row.right_hand_side,
        slack=row.slack,
        dual_value=dual,
        finite_difference=measured,
        agrees=priced.agrees,
    )
    return priced


def _restore(
    built: BuiltProblem, *, target: float, algorithm: str, nudged: bool, log: Logger
) -> None:
    """Put the compiled problem back on the target it arrived on.

    The `return_target` nudges re-solve the caller's own problem, which
    leaves its variables holding a book nobody asked for. Restoring costs
    one more solve, so it is done only when a nudge actually happened; the
    alternative is handing back a `BuiltProblem` whose values silently
    belong to a target one part in ten thousand away from the caller's.
    """
    if not nudged:
        return
    solve_problem(built, algorithm=algorithm, target=target, log=log)


def _restore_after_failure(
    built: BuiltProblem, *, target: float, algorithm: str, nudged: bool, log: Logger
) -> None:
    """Try the same restore, but never at the cost of the real failure.

    This runs while an exception is already propagating. The restore
    itself solves, so it can fail too — and if it were allowed to raise
    here it would replace the diagnosis the caller needs with a second,
    downstream one. So it is attempted, logged either way, and swallowed.
    """
    try:
        _restore(built, target=target, algorithm=algorithm, nudged=nudged, log=log)
    except Exception as cleanup_err:
        log.warning(
            "Restoring the compiled problem failed; reporting the original "
            "failure instead.",
            target=target,
            cleanup_error=str(cleanup_err),
        )


def build_dual_table(
    scenario: Scenario,
    market: MarketScenarios,
    built: BuiltProblem,
    outcome: SolveOutcome,
    *,
    log: Logger,
) -> tuple[DualRow, ...]:
    """Price every labelled constraint of a solved book and check each price.

    Args:
        scenario: The mandate the book was solved under, and the
            `constraint_abs` and `dual_relative` tolerances.
        market: The `[S, N]` matrix the book was chosen on. Needed because
            four of the five bounds are rebuilt rather than re-parameterized
            when they are nudged.
        built: The compiled problem the outcome came from. Its `target`
            parameter says which target was solved, and is re-solved at
            nudged values for the `return_target` row.
        outcome: The solve to price. It must carry a solution, and its
            duals come from it.
        log: Logger for the operation boundary.

    Returns:
        One row per label in `model_desk.DUAL_BEARING_LABELS`, in that
        order. `agrees` is true only where a finite difference actually
        confirmed the dual, so an inactive row — which is never re-solved
        — reports `False` beside `active=False` and a `None` difference.
        `console.py` distinguishes the two: an unpriced limit is not a
        failed check.

    Raises:
        SolveError: If `outcome` carries no solution, if the compiled
            problem's target parameter is unset, or if the solver reported
            no dual for one of the labelled constraints — none of which is
            a number this table is willing to invent.
    """
    if outcome.solution is None:
        raise SolveError(
            f"cannot price the constraints of a solve that returned no weights; "
            f"{outcome.solver_name} reported status {outcome.status!r}"
        )

    target = _solved_target(built)
    algorithm = outcome.solver_name
    rows = constraint_rows(scenario, market.returns, outcome.solution, target=target)
    # Only the return target's nudges re-solve the caller's own problem —
    # the rest rebuild — so that one row decides whether the restore below
    # has anything to undo.
    nudged = any(
        row.label == RETURN_TARGET_LABEL
        and is_active(row, tolerance=scenario.tolerances.constraint_abs)
        for row in rows
    )
    table_log = log.bind(solver=algorithm, target=target, labels=len(rows))
    try:
        table_log.info("Pricing the desk limits...")
        priced = [
            _price_row(
                scenario,
                market,
                built,
                row,
                dual=_dual_of(outcome, row.label),
                target=target,
                algorithm=algorithm,
                log=log,
            )
            for row in rows
        ]
    except Exception:
        table_log.exception("Pricing the desk limits failed.")
        _restore_after_failure(
            built, target=target, algorithm=algorithm, nudged=nudged, log=table_log
        )
        raise
    else:
        _restore(built, target=target, algorithm=algorithm, nudged=nudged, log=log)
        table_log.info(
            "Pricing the desk limits succeeded.",
            active=[row.label for row in priced if row.active],
            verified=[row.label for row in priced if row.agrees],
            unverified=[row.label for row in priced if row.active and not row.agrees],
        )
        return tuple(priced)
