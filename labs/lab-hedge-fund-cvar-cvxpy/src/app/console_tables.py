"""The three tables that describe the solved book: limits, costs and tail.

Every number here is read off the `VerificationReport`, which rebuilt it
in NumPy from the weight vector, or off `limits.py`, which measures each
constraint on the expression the model writes it on. Nothing is read back
off a CVXPY expression, and this module never imports CVXPY.

The exposure table is the one with a trap in it, and it is worth naming
where a reader will meet it. Four of the limits are enforced on `l + s` or
on `t` rather than on the book, so the row the solver sees can be pressed
against its cap while the book sits well below it. The table therefore
prints the row and the book in two separately headed columns, decides
`binding` on the row alone, and prints no slack column at all: the room
left in a relaxed row is not balance sheet anyone can use, and the shadow
price a few tables further down is what says whether a limit is scarce.

This file runs a little past the ~200-line target the lab holds its
modules to: about 185 lines are executable, and the rest is the warning
above plus the two headings that say which estimator each `out - in`
column belongs to — both of which belong beside the tables they are
about.
"""

from __future__ import annotations

from app.console_format import (
    ABSENT,
    basis_points,
    nav_percent,
    row,
    rule,
    yes_no,
)
from app.contracts import (
    PortfolioSolution,
    Scenario,
    TailStatistics,
    VerificationReport,
)
from app.limits import BETA_UNIT, LimitRow, limit_rows
from app.output import write_line
from app.studies_optimism import OptimismResult

_LIMIT_WIDTHS = (22, 10, 6, 9, 9, 7, 9)
_TAIL_WIDTHS = (22, 12, 14, 13)
_OPTIMISM_WIDTHS = (22, 12, 14, 13)


def _limit_value(value: float, unit: str) -> str:
    """Write one limit figure on the ruler its row is measured in."""
    return f"{value:.4f}" if unit == BETA_UNIT else nav_percent(value)


def _limit_line(entry: LimitRow, *, tolerance: float) -> str:
    """Lay out one limit: the model's row, the cap, and the book beside it."""
    return row(
        [
            entry.description,
            entry.written_on,
            entry.unit,
            _limit_value(entry.row_value, entry.unit),
            _limit_value(entry.cap, entry.unit),
            yes_no(entry.binding(tolerance=tolerance)),
            _limit_value(entry.book_value, entry.unit),
        ],
        _LIMIT_WIDTHS,
    )


def print_exposures(scenario: Scenario, solution: PortfolioSolution) -> None:
    """Print every desk limit measured on its own left-hand side.

    Args:
        scenario: The mandate and the `constraint_abs` tolerance the
            activity test uses.
        solution: The solved weights and legs.
    """
    write_line("Desk limits")
    write_line(
        "  `binding` is measured on the expression named in `written on`, which is what"
    )
    write_line(
        "  the model constrains -- never on the `book` figure beside it. Where a limit"
    )
    write_line(
        "  is written on `l + s` or on `t` those are two different numbers, and only"
    )
    write_line(
        "  the first decides the row. Room left in a row is not spare balance sheet:"
    )
    write_line("  what a limit is worth is its shadow price further down.")
    write_line(
        row(
            ["limit", "written on", "unit", "row", "cap", "binding", "book"],
            _LIMIT_WIDTHS,
        )
    )
    write_line(rule(_LIMIT_WIDTHS))
    for entry in limit_rows(scenario.universe, scenario.limits, solution):
        write_line(_limit_line(entry, tolerance=scenario.tolerances.constraint_abs))
    write_line()


def print_ledger(report: VerificationReport, *, target: float) -> None:
    """Print what the book earns and what it pays, in basis points a month.

    Both costs are recomputed from the weights: borrow on `max(-w, 0)` and
    the half-spread on `|w - w0|`, not on the model's `s` and `t` legs.
    Where a relaxation has lapsed the model charged more than this, and
    the gap is exactly what `relaxation_max_overlap` measures.
    """
    gross = basis_points(report.expected_gross_return)
    write_line("Expected monthly return, recomputed from the weights (bp of NAV)")
    write_line(f"  gross return        {gross:>10}")
    write_line(
        f"  borrow cost         {basis_points(-report.borrow_cost):>10}"
        "   annual fee / 12 on short notional"
    )
    write_line(
        f"  trading cost        {basis_points(-report.trading_cost):>10}"
        "   half-spread on traded notional"
    )
    write_line(
        f"  net return          {basis_points(report.expected_net_return):>10}"
        f"   against a target of {basis_points(target)}"
    )
    write_line()


def _tail_line(label: str, in_sample: float, scored: float) -> str:
    """Lay out one tail figure in sample, out of sample, and out minus in."""
    return row(
        [
            label,
            basis_points(in_sample),
            basis_points(scored),
            basis_points(scored - in_sample),
        ],
        _TAIL_WIDTHS,
    )


def _print_agreement(report: VerificationReport) -> None:
    """Print the independent paths to the same tail average, and the checks."""
    passed = sum(1 for _, ok in report.checks if ok)
    write_line("  Four independent readings of the same number (bp of NAV)")
    write_line(f"    model objective       {basis_points(report.model_objective):>10}")
    write_line(f"    sum_largest oracle    {basis_points(report.atom_oracle_cvar):>10}")
    write_line(f"    empirical CVaR        {basis_points(report.empirical_cvar):>10}")
    write_line(
        f"    VaR recovery gap      {basis_points(report.var_recovery_gap):>10}"
        f"   over {report.threshold_count} scenarios on the threshold"
    )
    write_line(
        f"    signed-split overlap  {nav_percent(report.relaxation_max_overlap):>10}"
        "   %NAV, max_i min(l_i, s_i)"
    )
    write_line(f"    checks passed         {passed:>10} of {len(report.checks)}")


def print_tails(
    report: VerificationReport,
    *,
    beta: float,
    in_sample_scenarios: int,
    out_of_sample_scenarios: int,
    optimism: OptimismResult,
    study_scenarios: int,
) -> None:
    """Print the headline book's tail, then the seed-averaged ladder.

    Two different estimators of the same effect, printed ten lines apart,
    so each says in its own heading which it is. The first is **one draw**
    — this run's in-sample matrix against this run's out-of-sample matrix,
    for the one book the report is about. The second **averages seeds**,
    redrawing the in-sample matrix at every rung and scoring against a
    single larger ruler. Both use the same sign convention, named in the
    column heading rather than left to a docstring: `out - in`, so a
    positive number is an optimistic in-sample tail.

    A single draw's gap carries the seed-to-seed noise of both tail
    estimates and can land either side of zero while the averaged ladder
    is firmly positive. That is the two estimators behaving correctly, not
    a contradiction, which is why the heading says which is which and the
    reader is pointed at the averaged one for the size of the effect.
    """
    in_sample: TailStatistics = report.in_sample
    scored: TailStatistics = report.out_of_sample
    write_line(f"Tail risk at {beta * 100:.0f}% confidence (bp of NAV per month)")
    write_line(
        f"  One draw: this run's {in_sample_scenarios} in-sample scenarios, scored "
        f"against this"
    )
    write_line(
        f"  run's {out_of_sample_scenarios} out-of-sample scenarios, for the one "
        f"book above. `out - in`"
    )
    write_line(
        "  is out of sample minus in sample, so a positive number means the reported"
    )
    write_line(
        "  tail was optimistic. One draw of it carries the sampling noise of both"
    )
    write_line("  estimates and can fall either side of zero; the seed-averaged ladder")
    write_line("  below is where the size of the effect lives.")
    write_line(row(["", "in sample", "out of sample", "out - in"], _TAIL_WIDTHS))
    write_line(rule(_TAIL_WIDTHS))
    write_line(_tail_line("VaR", in_sample.var, scored.var))
    write_line(_tail_line("CVaR", in_sample.cvar, scored.cvar))
    write_line(
        row(
            [
                "tail scenarios",
                str(in_sample.tail_count),
                str(scored.tail_count),
                ABSENT,
            ],
            _TAIL_WIDTHS,
        )
    )
    write_line()
    _print_agreement(report)
    write_line()
    _print_optimism(optimism, study_scenarios=study_scenarios)


def _print_optimism(optimism: OptimismResult, *, study_scenarios: int) -> None:
    """Print how much of the in-sample tail is sampling luck, by sample size."""
    write_line(
        f"  How optimistic the in-sample tail is, averaged over "
        f"{optimism.seeds} seeds (bp of NAV)"
    )
    write_line(
        "  A different estimator from the table above, and the one to read for the"
    )
    write_line(
        "  size of the effect: every row redraws an in-sample matrix of that size for"
    )
    write_line(
        f"  each seed, scores the book on one fixed {study_scenarios}-scenario "
        f"ruler, and"
    )
    write_line("  averages. Same sign convention, so a positive `out - in` is again an")
    write_line("  optimistic in-sample tail.")
    write_line(
        row(["  scenarios", "in sample", "out of sample", "out - in"], _OPTIMISM_WIDTHS)
    )
    write_line(rule(_OPTIMISM_WIDTHS))
    for entry in optimism.rows:
        write_line(
            row(
                [
                    f"  {entry.scenarios}",
                    basis_points(entry.in_sample_cvar),
                    basis_points(entry.out_of_sample_cvar),
                    basis_points(entry.gap),
                ],
                _OPTIMISM_WIDTHS,
            )
        )
    write_line()
