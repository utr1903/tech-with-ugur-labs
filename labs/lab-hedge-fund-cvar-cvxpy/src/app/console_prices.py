"""The shadow prices, translated out of solver units into desk sentences.

`duals.py` produces the numbers and says which of them mean anything.
This module does the last step: turning a rate of change into a sentence
a portfolio manager can argue with, in the units they would use.

**The translation.** Every price below is quoted in basis points of the
book's 95% CVaR per a named amount of the limit, because a dual arrives in
the units of its own bound and those differ per row — one is per unit of
monthly return, one per turn of balance sheet, one per unit of beta. The
`per` column names the amount each row's price is quoted for, and the
sentences underneath spell the same number out.

**Two different things print as an unconfirmed price, and they are not the
same finding.** `DualRow.agrees` is False both when the row was never
checked and when the check came back unusable, so nothing here prints that
field on its own: the `check` column holds
`lib.dual_verdicts.check_verdict`, which separates the four situations,
and the argument for the separation is written out there beside the
vocabulary the artifacts use too.

**A row's remaining room is not its worth.** The header above the table
prints the book's own `sum |w|` next to the gross cap, and says in so many
words that what decides whether balance sheet is scarce is the
`gross_leverage` price in the table and not the room left in any row.
Measured on the shipped mandate at 10,000 scenarios and a 0.002 return
target, that distinction is the difference between a row sitting 0.0031
from its cap and a limit whose price is 5.0e-14.

This file runs a little past the ~200-line target the lab holds its
modules to, and the reason is prose: about 120 lines are executable and
the rest is the argument above, which is the one a reader of the table
most needs.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.console_format import BASIS_POINT, nav_percent, row, rule, yes_no
from app.contracts import DeskLimits, DualRow, VerificationReport
from app.lib.dual_verdicts import check_verdict
from app.output import write_line

_DUAL_WIDTHS = (18, 9, 11, 20, 30)


@dataclass(frozen=True)
class Reading:
    """How one shadow price is quoted and what sentence it becomes.

    `unit_size` is how much of that limit's own bound the quoted price is
    for, in the bound's own units: a basis point of required return, a
    whole turn of gross, ten points of turnover budget, one point of beta
    band. `unit_name` is that amount written out for the table's `per`
    column, and `sentence` is the same number as a line a desk would say.
    """

    unit_size: float
    unit_name: str
    sentence: str


# One entry per label in `model_desk.DUAL_BEARING_LABELS`. Each
# `unit_size` is in the units of that constraint's own right-hand side:
# `return_target` is a monthly return, `gross_leverage` a fraction of NAV,
# `turnover_budget` a fraction of NAV traded one way, and the two beta
# rows a portfolio beta.
READINGS = {
    "return_target": Reading(
        unit_size=BASIS_POINT,
        unit_name="1 bp of target",
        sentence=(
            "one extra basis point of required monthly return costs "
            "{price} bp of 95% CVaR"
        ),
    ),
    "gross_leverage": Reading(
        unit_size=1.0,
        unit_name="1.00 turn of gross",
        sentence="one more turn of gross saves {price} bp of CVaR",
    ),
    "turnover_budget": Reading(
        unit_size=0.10,
        unit_name="10 pts of turnover",
        sentence="10 more points of turnover budget saves {price} bp of CVaR",
    ),
    "beta_upper": Reading(
        unit_size=0.01,
        unit_name="0.01 of beta band",
        sentence=(
            "the neutrality mandate costs {price} bp of CVaR at the upper "
            "edge, per 0.01 of band"
        ),
    ),
    "beta_lower": Reading(
        unit_size=0.01,
        unit_name="0.01 of beta band",
        sentence=(
            "the neutrality mandate costs {price} bp of CVaR at the lower "
            "edge, per 0.01 of band"
        ),
    ),
}

# What a row whose label carries no reading is quoted in. Unreachable
# while `READINGS` covers `DUAL_BEARING_LABELS`, which `console_test.py`
# asserts; it exists so an added label prints as unquoted rather than
# crashing the report of a run that already cost three minutes.
UNQUOTED = Reading(unit_size=1.0, unit_name="1.00 of the bound", sentence="")


def price_in_basis_points(entry: DualRow) -> float:
    """Convert one dual into basis points of CVaR per its quoted amount."""
    reading = READINGS.get(entry.label, UNQUOTED)
    return entry.dual_value * reading.unit_size / BASIS_POINT


def _dual_line(entry: DualRow) -> str:
    """Lay out one priced limit."""
    reading = READINGS.get(entry.label, UNQUOTED)
    return row(
        [
            entry.label,
            yes_no(entry.active),
            f"{price_in_basis_points(entry):.2f}",
            reading.unit_name,
            check_verdict(entry),
        ],
        _DUAL_WIDTHS,
    )


def _print_header(report: VerificationReport, limits: DeskLimits) -> None:
    """Explain what a shadow price is, and what it is not."""
    write_line("What each desk limit costs, in bp of 95% CVaR")
    write_line(
        "  A shadow price is the rate at which the book's tail loss worsens as that"
    )
    write_line(
        "  limit is tightened. It means something only where the constraint is active,"
    )
    write_line(
        "  and a price near machine epsilon is the absence of a price rather than a"
    )
    write_line("  small one.")
    write_line(
        f"  The book itself holds {nav_percent(report.gross_leverage)}% of NAV "
        f"gross, which is its own sum |w|."
    )
    write_line(
        f"  The gross cap is {nav_percent(limits.gross_leverage_max)}%, and the "
        f"model writes it on sum(l + s) --"
    )
    write_line(
        "  a different expression, never below sum |w|. Do not subtract the two:"
    )
    write_line(
        "  the difference is not balance sheet the book could use, and neither is"
    )
    write_line(
        "  the room left in the row. The gross_leverage price below is what says"
    )
    write_line("  whether balance sheet is scarce.")


def print_duals(
    duals: tuple[DualRow, ...], report: VerificationReport, limits: DeskLimits
) -> None:
    """Print the shadow-price table and read the active prices out loud.

    Args:
        duals: One row per labelled constraint, as `duals.py` produced it.
        report: The verified book, for the `sum |w|` printed beside the
            gross cap.
        limits: The mandate, for that cap.
    """
    _print_header(report, limits)
    write_line(row(["limit", "binding", "price", "per", "check"], _DUAL_WIDTHS))
    write_line(rule(_DUAL_WIDTHS))
    for entry in duals:
        write_line(_dual_line(entry))
    write_line()
    _print_readings(duals)


def _print_readings(duals: tuple[DualRow, ...]) -> None:
    """Spell the active prices out as sentences, and say if there are none."""
    active = [entry for entry in duals if entry.active and entry.label in READINGS]
    if not active:
        write_line("  No limit is active at this book, so none of them has a price.")
        write_line()
        return
    write_line("  Reading the active prices")
    for entry in active:
        sentence = READINGS[entry.label].sentence.format(
            price=f"{price_in_basis_points(entry):.2f}"
        )
        write_line(f"    {sentence}")
    write_line()
