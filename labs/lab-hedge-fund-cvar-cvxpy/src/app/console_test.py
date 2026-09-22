"""Tests for the reader surface.

Most of these are about what the console must *not* say. A status must not
be softened, a book must not appear under an infeasible headline, a
relaxed row's remaining room must not be printed as spare balance sheet,
and two quite different reasons for an unconfirmed shadow price must not
share one label.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.bundle import RunBundle
from app.console import DISPLAY_THRESHOLD, print_report
from app.console_format import basis_points, nav_percent
from app.console_prices import (
    CONFIRMED,
    DISAGREES,
    NOT_PRICED,
    READINGS,
    UNCONFIRMED,
    check_verdict,
    price_in_basis_points,
)
from app.contracts import DualRow
from app.model_desk import DUAL_BEARING_LABELS


def _report(bundle: RunBundle, capsys: pytest.CaptureFixture[str]) -> str:
    """Print one bundle and hand back everything it wrote."""
    print_report(bundle)
    return capsys.readouterr().out


def test_console_reports_an_inaccurate_status_as_inaccurate(
    capsys: pytest.CaptureFixture[str], inaccurate_bundle: RunBundle
) -> None:
    """A method that stopped short of its tolerance says so, in its own word."""
    out = _report(inaccurate_bundle, capsys)
    assert "optimal_inaccurate" in out


def test_console_never_prints_a_weight_table_without_a_solution(
    capsys: pytest.CaptureFixture[str], infeasible_bundle: RunBundle
) -> None:
    """No weights means no book, and no table of one."""
    out = _report(infeasible_bundle, capsys)
    assert "infeasible" in out
    assert "Optimal book" not in out


def test_an_infeasible_run_still_reports_what_does_not_need_a_book(
    capsys: pytest.CaptureFixture[str], infeasible_bundle: RunBundle
) -> None:
    """The sweep and the ladder are properties of the mandate, not the book."""
    out = _report(infeasible_bundle, capsys)
    assert "Frontier sweep" in out
    assert "The same program under three algorithms" in out
    assert "What each desk limit costs" not in out


def test_the_report_names_the_market_and_the_sample_it_was_measured_at(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """Every figure below the header is a measurement at this sample size."""
    out = _report(bundle, capsys)
    scenarios = int(bundle.market.returns.shape[0])
    assert f"{scenarios} scenarios" in out
    assert bundle.market.mode in out
    assert bundle.market.digest in out


def test_the_book_table_folds_the_small_names_in_rather_than_dropping_them(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """The listed lines plus the folded row account for every name."""
    out = _report(bundle, capsys)
    solution = bundle.headline.solution
    assert solution is not None
    listed = sum(
        1
        for index in range(len(bundle.scenario.universe.names))
        if abs(solution.weights[index]) >= DISPLAY_THRESHOLD
        or abs(solution.weights[index] - bundle.scenario.universe.start_book[index])
        >= DISPLAY_THRESHOLD
    )
    assert f"{listed} of 30 names listed" in out
    assert f"{30 - listed} names" in out
    assert "30 names" in out


def test_the_limit_table_shows_the_row_and_the_book_as_separate_columns(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """Both numbers appear, each under its own heading, and neither as slack.

    `gross_leverage` is written on `l + s`, so the row and the book are
    different quantities. The table prints both and labels which is which;
    it never prints their difference, and it never prints the row's
    remaining room, because neither is capacity the book could use.
    """
    out = _report(bundle, capsys)
    solution = bundle.headline.solution
    assert solution is not None
    row_value = float((solution.long_leg + solution.short_leg).sum())
    book_value = float(np.abs(solution.weights).sum())
    header = next(
        line for line in out.splitlines() if line.strip().startswith("limit ")
    )
    assert "written on" in header
    assert "row" in header
    assert "cap" in header
    assert "binding" in header
    assert "book" in header
    for forbidden in ("slack", "headroom", "room", "spare", "left"):
        assert forbidden not in header.lower()
    assert "l + s" in out
    assert nav_percent(row_value) in out
    assert nav_percent(book_value) in out


def test_the_shadow_prices_are_introduced_with_the_books_own_gross(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """`sum |w|` sits beside the cap, and the dual is what settles scarcity."""
    out = _report(bundle, capsys)
    report = bundle.verification
    assert report is not None
    assert f"The book holds {nav_percent(report.gross_leverage)}% of NAV gross" in out
    assert "gross_leverage price below" in out


def test_every_priced_label_has_a_reading() -> None:
    """A dual the model labels is a dual the console can say out loud."""
    assert set(READINGS) == set(DUAL_BEARING_LABELS)


def _dual(
    label: str, *, active: bool, difference: float | None, agrees: bool
) -> DualRow:
    """Build one shadow-price row in a named state."""
    return DualRow(
        label=label,
        active=active,
        dual_value=0.5,
        finite_difference=difference,
        agrees=agrees,
    )


def test_the_two_meanings_of_an_unconfirmed_price_read_differently() -> None:
    """`agrees` is false in three distinct situations, and they are not one.

    A row that is not active was never checked, because there is no price
    to check. An active row whose nudged re-solves came back unusable has
    a price nobody could confirm. Printing one label for both would show a
    reader an unverifiable number as a wrong one.
    """
    unchecked = _dual("gross_leverage", active=False, difference=None, agrees=False)
    unconfirmed = _dual("gross_leverage", active=True, difference=None, agrees=False)
    wrong = _dual("gross_leverage", active=True, difference=9.0, agrees=False)
    confirmed = _dual("gross_leverage", active=True, difference=-0.5, agrees=True)

    assert check_verdict(unchecked) == NOT_PRICED
    assert check_verdict(unconfirmed) == UNCONFIRMED
    assert check_verdict(wrong) == DISAGREES
    assert check_verdict(confirmed) == CONFIRMED
    assert len({NOT_PRICED, UNCONFIRMED, DISAGREES, CONFIRMED}) == 4


def test_each_price_is_quoted_per_the_amount_its_sentence_names() -> None:
    """The table's number and the sentence's number are the same number.

    A dual arrives in the units of its own bound, so the four rows are not
    comparable until each is multiplied by the amount its sentence moves:
    one basis point of required return, a whole turn of gross, ten points
    of turnover, one point of beta band.
    """
    assert price_in_basis_points(
        _dual("return_target", active=True, difference=None, agrees=False)
    ) == pytest.approx(0.5)
    assert price_in_basis_points(
        _dual("gross_leverage", active=True, difference=None, agrees=False)
    ) == pytest.approx(5000.0)
    assert price_in_basis_points(
        _dual("turnover_budget", active=True, difference=None, agrees=False)
    ) == pytest.approx(500.0)
    assert price_in_basis_points(
        _dual("beta_upper", active=True, difference=None, agrees=False)
    ) == pytest.approx(50.0)


def test_only_the_active_prices_are_read_out_loud(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """An inactive limit has no price, so it gets no sentence."""
    out = _report(bundle, capsys)
    for entry in bundle.duals:
        sentence = READINGS[entry.label].sentence.format(
            price=f"{price_in_basis_points(entry):.2f}"
        )
        assert (sentence in out) is entry.active, entry.label


def test_a_run_with_no_active_limit_says_so(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """The sentence block is never silently empty."""
    slack = replace(
        bundle,
        duals=tuple(
            replace(entry, active=False, finite_difference=None, agrees=False)
            for entry in bundle.duals
        ),
    )
    out = _report(slack, capsys)
    assert "none of them has a price" in out


def test_the_return_ledger_adds_up(
    capsys: pytest.CaptureFixture[str], bundle: RunBundle
) -> None:
    """Gross minus borrow minus trading is the net the table prints."""
    out = _report(bundle, capsys)
    report = bundle.verification
    assert report is not None
    assert basis_points(report.expected_gross_return) in out
    assert basis_points(report.expected_net_return) in out
    assert report.expected_net_return == pytest.approx(
        report.expected_gross_return - report.borrow_cost - report.trading_cost
    )
