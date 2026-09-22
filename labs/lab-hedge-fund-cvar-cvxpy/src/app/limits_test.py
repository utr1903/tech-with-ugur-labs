"""Tests that the limit labels come from the model and not from a comment.

The first test here is the important one, and it exists because the
mistake it catches has already happened once in this lab: `scenario.yaml`
carried four limits described as bounds on `|w|` while the program wrote
them on `l + s`. The signature was exact — every limit genuinely written
on `w` was described correctly and every relaxed one was not — which is
what makes it a defect generator rather than four typos. So the mapping
in `limits.py` is asserted against the constraint objects
`model_desk.desk_block` actually builds, not against prose.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.contracts import (
    MarketScenarios,
    PortfolioSolution,
    Scenario,
    frozen_float_array,
)
from app.errors import ArtifactError
from app.limits import (
    LEGS,
    TURNOVER_LEG,
    WEIGHTS,
    WRITTEN_ON,
    limit_rows,
    written_on,
)
from app.logging_setup import Logger
from app.model import build_cvar_problem
from app.model_desk import desk_block
from app.solver import solve_problem

# The symbol `limits.py` writes for each of the four decision vectors
# `model_desk.desk_variables` declares. CVXPY renders a constraint with
# the name of every variable in it, so the symbols a label claims can be
# checked against the constraint's own text rather than against prose.
SYMBOL_OF = {
    "weights": "w",
    "long_leg": "l",
    "short_leg": "s",
    "turnover_leg": "t",
}


def _claimed(label: str) -> set[str]:
    """Return the symbols `limits.py` says this row is written on."""
    return set(written_on(label)) & set(SYMBOL_OF.values())


def _mentioned(constraint: object) -> set[str]:
    """Return the symbols the built constraint's own text names."""
    text = str(constraint)
    return {symbol for name, symbol in SYMBOL_OF.items() if name in text}


def test_every_label_names_the_expression_the_model_writes_it_on(
    small_scenario: Scenario, small_market: MarketScenarios
) -> None:
    """Read each constraint's own text and check its label against it."""
    families = desk_block(small_scenario, small_market.returns).families
    for label in WRITTEN_ON:
        assert _claimed(label) == _mentioned(families[label]), label


def test_the_three_gross_caps_are_written_on_the_legs() -> None:
    """The exact set the lab has previously mislabelled as bounds on `|w|`."""
    assert written_on("gross_leverage") == LEGS
    assert written_on("name_gross_cap") == LEGS
    assert written_on("sector_gross_cap") == LEGS
    assert written_on("turnover_budget") == TURNOVER_LEG


def test_the_rows_written_on_the_book_itself_say_so() -> None:
    """Net exposure, the sector net cap and the beta band have no such gap."""
    for label in (
        "net_exposure_max",
        "net_exposure_min",
        "sector_net_upper",
        "sector_net_lower",
        "beta_upper",
        "beta_lower",
    ):
        assert written_on(label) == WEIGHTS


def test_an_unknown_label_is_refused_rather_than_defaulted() -> None:
    """Defaulting would describe a relaxed row as if it bounded the book."""
    with pytest.raises(ArtifactError, match="gross_leverage"):
        written_on("gross_leverage_max")


def _padded_solution() -> PortfolioSolution:
    """Return a book whose signed split is padded by a tenth of NAV.

    The weights are a two-name long/short pair holding 0.20 of NAV gross,
    and every one of the thirty names carries 0.10 of padding on each leg.
    `l - s` still equals `w`, but each name's `l + s` is 0.20 above its
    `|w|`, so over thirty names `sum(l + s)` is 0.20 * 30 = 6.00 of NAV
    larger than `sum |w|`. That gap is exactly what the two columns of a
    `LimitRow` are there to keep apart.
    """
    raw = np.zeros(30)
    raw[0] = 0.10
    raw[1] = -0.10
    return PortfolioSolution(
        weights=frozen_float_array(raw),
        long_leg=frozen_float_array(np.maximum(raw, 0.0) + 0.10),
        short_leg=frozen_float_array(np.maximum(-raw, 0.0) + 0.10),
        turnover_leg=frozen_float_array(np.abs(raw)),
        var_auxiliary=0.0,
        objective=0.0,
    )


def test_a_padded_split_moves_the_row_and_leaves_the_book_alone(
    small_scenario: Scenario,
) -> None:
    """The row and the book are different numbers and are reported apart."""
    rows = {
        row.label: row
        for row in limit_rows(
            small_scenario.universe, small_scenario.limits, _padded_solution()
        )
    }
    gross = rows["gross_leverage"]
    assert gross.book_value == pytest.approx(0.20)
    assert gross.row_value == pytest.approx(0.20 + 30 * 0.20)
    assert gross.row_value > gross.book_value


def test_binding_is_decided_on_the_row_and_never_on_the_book(
    small_scenario: Scenario,
) -> None:
    """A cap set at the book's own gross is still slack on the padded row.

    The book holds 0.20 of NAV gross, so a cap of 0.20 reads as binding if
    the test is written on `sum |w|`. The model constrains `sum(l + s)`,
    which is 6.20 here, so the row is not against that cap at all — it is
    6.00 past it. `binding` has to answer for the row.
    """
    mandate = replace(small_scenario.limits, gross_leverage_max=0.20)
    rows = {
        row.label: row
        for row in limit_rows(small_scenario.universe, mandate, _padded_solution())
    }
    gross = rows["gross_leverage"]
    assert gross.book_value == pytest.approx(gross.cap)
    assert gross.slack == pytest.approx(-6.0)


def test_the_solved_book_measures_every_limit(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """Every row of a real solve is inside its cap, on its own expression."""
    built = build_cvar_problem(small_scenario, small_market, log=log)
    outcome = solve_problem(
        built,
        algorithm="CLARABEL",
        target=small_scenario.headline_target_monthly,
        log=log,
    )
    assert outcome.solution is not None
    rows = limit_rows(small_scenario.universe, small_scenario.limits, outcome.solution)
    assert len(rows) == 10
    for row in rows:
        assert row.slack >= -small_scenario.tolerances.constraint_abs, row.label
