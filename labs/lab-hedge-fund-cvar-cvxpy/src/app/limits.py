"""Every desk limit as a reader-facing row, measured where the model writes it.

The mandate in `scenario.yaml` reads as a set of statements about the
book — how much gross, how much turnover, how much of one name. The
program in `model_desk.py` does not always enforce it on the book. Four
of the limits are written on the relaxed legs instead:

* `gross_leverage`, `name_gross_cap` and `sector_gross_cap` on `l + s`;
* `turnover_budget` on `t`.

The other four families — net exposure, the sector *net* cap and the two
beta sides — are written on `w` itself, and there the two readings are the
same number. Every `written_on` string below is read off the constraint it
labels in `model_desk.desk_block`, and `limits_test.py` asserts each one
against the variables the built constraint actually mentions, so a limit
that is re-expressed in the model cannot keep a stale label here.

**What that means for anything printed.** `l + s >= |w|` and
`t >= |w - w0|` always, so the row can sit against its cap while the book
sits far below it. Measured on the shipped mandate at 10,000 scenarios and
a 0.002 return target, the book's `sum |w|` is 0.8200 while `sum(l + s)`
reads 1.3169 of the 1.32 cap — and the dual there is 5.0e-14, which is the
absence of a price rather than a small one. Widening that cap to 2.0 and
then to 6.0, at the same 10,000 scenarios and the same 0.002 target,
leaves the book at 0.8200 in all three, so the row's tightness is padding
rather than the book using its balance sheet. At those 10,000 scenarios
neither the row's remaining 0.0031 nor the 0.4969 between row and book is
capacity anyone could trade with. (How far an interior point pads a very
wide face is a property of the algorithm, so the row readings at the
widened caps are not quoted here as if they said something about the
model.)

So `binding` below is measured on `row_value` and never on `book_value`,
the two are carried in separate fields that the console prints under
separate headings, and neither is ever presented as headroom. What says a
limit is scarce is its shadow price, which `duals.py` produces and
`console.py` prints beside these rows.

This file runs past the ~200-line target the lab holds its modules to on
prose: about 150 lines are executable and the rest is the argument above,
which is written beside the mapping it governs on purpose. Moving the
reasoning away from the rows it justifies is how the equivalent rule came
to be broken in `scenario.yaml`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from app.contracts import DeskLimits, PortfolioSolution, Universe
from app.errors import ArtifactError

# The expressions `model_desk.desk_block` writes its rows on.
LEGS = "l + s"
TURNOVER_LEG = "t"
WEIGHTS = "w"

# The two rows measured in beta rather than in NAV. Everything else on
# the mandate is a fraction of NAV, and printing a beta of 0.02 under a
# percent-of-NAV heading would invent a unit the number does not have.
BETA_LABELS = ("beta_upper", "beta_lower")

# The unit each row's numbers carry, for the heading of any table that
# prints them.
NAV_UNIT = "%NAV"
BETA_UNIT = "beta"

# The one source of truth for which expression carries which limit, read
# off `model_desk.desk_block` constraint by constraint and pinned there by
# `limits_test.py`. Nothing here is copied from `scenario.yaml` or from a
# comment: the scenario file has carried four labels naming `|w|` for rows
# the model writes on `l + s`, and the signature of that defect was exact —
# every row genuinely written on `w` was right and every relaxed row was
# wrong. Reading the mapping off the model is what stops it recurring.
#
# `return_target` is the one priced row that is not a desk limit. Its
# left-hand side is `mu @ w - (borrow / 12) @ s - half_spread @ t`, so it
# is written on all three vectors at once.
WRITTEN_ON: Mapping[str, str] = {
    "return_target": "w, s, t",
    "gross_leverage": LEGS,
    "name_gross_cap": LEGS,
    "sector_gross_cap": LEGS,
    "turnover_budget": TURNOVER_LEG,
    "net_exposure_max": WEIGHTS,
    "net_exposure_min": WEIGHTS,
    "sector_net_upper": WEIGHTS,
    "sector_net_lower": WEIGHTS,
    "beta_upper": WEIGHTS,
    "beta_lower": WEIGHTS,
}


def written_on(label: str) -> str:
    """Return the expression the model writes `label` on.

    Raises:
        ArtifactError: If `label` is not one of the model's constraint
            families. An unknown label is refused rather than defaulted to
            `w`, because defaulting would describe a relaxed row as if it
            were written on the book.
    """
    expression = WRITTEN_ON.get(label)
    if expression is None:
        raise ArtifactError(
            f"{label!r} is not a constraint family this lab can label; the "
            f"model writes {', '.join(sorted(WRITTEN_ON))}"
        )
    return expression


@dataclass(frozen=True)
class LimitRow:
    """One desk limit at one book, measured twice on purpose.

    `row_value` is the constraint's own left-hand side, which is what
    `binding` is decided on. `book_value` is the portfolio quantity the
    limit is *about*, which is what a reader wants to know the book holds.
    They are equal wherever `written_on` is `w`, and they part company on
    the relaxed rows — see the module docstring.

    `sense` is `"<="` or `">="`, and it is what turns the two numbers into
    an activity test without a second table of signs. `unit` says which
    ruler the three numbers are on, since the beta band is the one limit
    that is not a fraction of NAV.
    """

    label: str
    description: str
    written_on: str
    unit: str
    sense: str
    row_value: float
    cap: float
    book_value: float

    @property
    def slack(self) -> float:
        """How far the constraint's own left-hand side is from its bound.

        Signed the feasible way round: positive means the row has room.
        This is a property of the *row*, not of the book, so it is never a
        statement about spare balance sheet where the row is a relaxation.
        """
        if self.sense == "<=":
            return self.cap - self.row_value
        return self.row_value - self.cap

    def binding(self, *, tolerance: float) -> bool:
        """Is the optimum pressed against this bound, within `tolerance`?"""
        return self.slack <= tolerance


def _row(
    label: str, description: str, sense: str, row: float, cap: float, book: float
) -> LimitRow:
    """Build one measured row, taking its expression from `WRITTEN_ON`."""
    return LimitRow(
        label=label,
        description=description,
        written_on=written_on(label),
        unit=BETA_UNIT if label in BETA_LABELS else NAV_UNIT,
        sense=sense,
        row_value=row,
        cap=cap,
        book_value=book,
    )


def _at_most(
    label: str, description: str, row: float, cap: float, book: float
) -> LimitRow:
    """Build the row for a `row <= cap` limit."""
    return _row(label, description, "<=", row, cap, book)


def _at_least(
    label: str, description: str, row: float, cap: float, book: float
) -> LimitRow:
    """Build the row for a `row >= cap` limit."""
    return _row(label, description, ">=", row, cap, book)


def limit_rows(
    universe: Universe, limits: DeskLimits, solution: PortfolioSolution
) -> tuple[LimitRow, ...]:
    """Measure every desk limit on its own left-hand side and on the book.

    Args:
        universe: The sector indicator, the betas and the starting book.
        limits: The mandate the book was solved under.
        solution: The solved weights *and* legs. The legs are load-bearing:
            four of these rows are written on them and cannot be rebuilt
            from `weights` alone.

    Returns:
        One row per constraint family in `model_desk.desk_block`, in the
        order the console prints them.
    """
    weights = solution.weights
    gross_leg = solution.long_leg + solution.short_leg
    absolute = np.abs(weights)
    sector = universe.sector_matrix
    net_exposure = float(weights.sum())
    beta_exposure = float(universe.market_beta @ weights)
    sector_net = sector @ weights
    return (
        _at_most(
            "gross_leverage",
            "gross leverage",
            float(gross_leg.sum()),
            limits.gross_leverage_max,
            float(absolute.sum()),
        ),
        _at_most(
            "name_gross_cap",
            "largest single name",
            float(gross_leg.max()),
            limits.name_gross_cap,
            float(absolute.max()),
        ),
        _at_most(
            "sector_gross_cap",
            "largest sector gross",
            float((sector @ gross_leg).max()),
            limits.sector_gross_cap,
            float((sector @ absolute).max()),
        ),
        _at_most(
            "turnover_budget",
            "turnover, one way",
            float(solution.turnover_leg.sum()),
            limits.turnover_max,
            float(np.abs(weights - universe.start_book).sum()),
        ),
        _at_most(
            "net_exposure_max",
            "net exposure, upper",
            net_exposure,
            limits.net_exposure_max,
            net_exposure,
        ),
        _at_least(
            "net_exposure_min",
            "net exposure, lower",
            net_exposure,
            limits.net_exposure_min,
            net_exposure,
        ),
        _at_most(
            "sector_net_upper",
            "sector net, upper",
            float(sector_net.max()),
            limits.sector_net_cap,
            float(sector_net.max()),
        ),
        _at_least(
            "sector_net_lower",
            "sector net, lower",
            float(sector_net.min()),
            -limits.sector_net_cap,
            float(sector_net.min()),
        ),
        _at_most(
            "beta_upper",
            "market beta, upper",
            beta_exposure,
            limits.beta_max,
            beta_exposure,
        ),
        _at_least(
            "beta_lower",
            "market beta, lower",
            beta_exposure,
            limits.beta_min,
            beta_exposure,
        ),
    )
