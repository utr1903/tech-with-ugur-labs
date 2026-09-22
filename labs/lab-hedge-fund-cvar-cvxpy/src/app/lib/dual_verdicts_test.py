"""Tests that the four outcomes of a shadow-price check stay four.

`DualRow.agrees` is false in three distinct situations and the contract
cannot say which. Collapsing any two of them back into one label is the
defect this module exists to prevent, so the test builds every state and
asserts the verdicts are distinct rather than asserting three specific
strings and leaving the fourth free to collide with one of them.
"""

from __future__ import annotations

from app.contracts import DualRow
from app.lib.dual_verdicts import (
    CONFIRMED,
    DISAGREES,
    NOT_PRICED,
    UNCONFIRMED,
    check_verdict,
)


def _dual(*, active: bool, difference: float | None, agrees: bool) -> DualRow:
    """Build one shadow-price row in a named state."""
    return DualRow(
        label="gross_leverage",
        active=active,
        dual_value=0.5,
        finite_difference=difference,
        agrees=agrees,
    )


def test_an_inactive_row_was_never_checked() -> None:
    """No price means no re-solve was attempted, and nothing is wrong."""
    row = _dual(active=False, difference=None, agrees=False)
    assert check_verdict(row) == NOT_PRICED


def test_an_active_row_with_no_difference_could_not_be_confirmed() -> None:
    """Both nudged programs came back unusable, so the price is unverified."""
    row = _dual(active=True, difference=None, agrees=False)
    assert check_verdict(row) == UNCONFIRMED


def test_an_active_row_whose_difference_disagrees_says_so() -> None:
    """The one finding worth alarm reads differently from the two above."""
    row = _dual(active=True, difference=9.0, agrees=False)
    assert check_verdict(row) == DISAGREES


def test_a_confirmed_price_says_it_was_confirmed() -> None:
    """A re-solve that agreed is the only outcome that claims a check."""
    row = _dual(active=True, difference=-0.5, agrees=True)
    assert check_verdict(row) == CONFIRMED


def test_the_three_meanings_of_a_false_agrees_are_three_strings() -> None:
    """A reader shown one label for two of these reads the wrong finding.

    Asserted as a set so that renaming any verdict into another's wording
    fails here rather than silently merging two states in a CSV cell.
    """
    assert len({NOT_PRICED, UNCONFIRMED, DISAGREES, CONFIRMED}) == 4
