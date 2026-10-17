"""What happened to a shadow price's check, said once for every consumer.

`DualRow.agrees` is false in three different situations and the field
cannot tell them apart:

* the row is not active, so it carries no price and no re-solve was ever
  attempted — nothing is wrong;
* the row is active but both nudged programs came back infeasible or
  merely `optimal_inaccurate`, so the price *could not be* confirmed;
* the row is active, a finite difference exists, and it genuinely
  disagrees — the one finding worth alarm.

A reader shown one label for the first two reads an unverifiable price as
a wrong one, so nothing in this lab prints or serializes `agrees` on its
own. It prints `check_verdict` beside it.

This lives under `lib/` rather than in `console_prices.py` because it has
two consumers in two domains: the console table and both artifact
writers. A CSV cell and a JSON field holding a string owned by the
console module would make the display layer the source of truth for what
a run recorded.
"""

from __future__ import annotations

from app.contracts import DualRow

# The four verdicts. The middle two are what a false `agrees` can mean.
NOT_PRICED = "not binding, so not checked"
UNCONFIRMED = "active, re-solve unusable"
DISAGREES = "re-solve DISAGREES with price"
CONFIRMED = "confirmed by a re-solve"


def check_verdict(entry: DualRow) -> str:
    """Say what happened to this row's finite-difference check.

    Args:
        entry: One priced constraint, as `duals.py` produced it.

    Returns:
        One of the four verdicts above, all distinct.
    """
    if not entry.active:
        return NOT_PRICED
    if entry.finite_difference is None:
        return UNCONFIRMED
    return CONFIRMED if entry.agrees else DISAGREES
