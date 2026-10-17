"""Rejection tests for the universe, the desk mandate and the start book.

Every case breaks exactly one thing in the shipped scenario and asserts the
error names the YAML path a reader would have to edit.
"""

from __future__ import annotations

import pytest

from app.conftest import Document, MutatedLoader, Mutation
from app.errors import ScenarioError


def _certain_cvar_beta(document: Document) -> None:
    document["cvar_beta"] = 1.0


def _impossible_cvar_beta(document: Document) -> None:
    document["cvar_beta"] = 0.0


def _negative_borrow_fee(document: Document) -> None:
    document["universe"]["names"][0]["borrow_fee_annual"] = -0.01


def _negative_half_spread(document: Document) -> None:
    document["universe"]["names"][2]["half_spread"] = -0.0001


def _drop_one_name(document: Document) -> None:
    document["universe"]["names"].pop()


def _duplicate_a_name(document: Document) -> None:
    document["universe"]["names"][1]["name"] = document["universe"]["names"][0]["name"]


def _add_a_seventh_sector(document: Document) -> None:
    document["universe"]["sectors"].append("utilities")


def _move_a_name_between_sectors(document: Document) -> None:
    document["universe"]["names"][0]["sector"] = "staples"


def _invert_the_net_exposure_band(document: Document) -> None:
    document["desk_limits"]["net_exposure_min"] = 0.20


def _invert_the_beta_band(document: Document) -> None:
    document["desk_limits"]["beta_min"] = 0.50


def _zero_gross_leverage(document: Document) -> None:
    document["desk_limits"]["gross_leverage_max"] = 0.0


def _negative_turnover_budget(document: Document) -> None:
    document["desk_limits"]["turnover_max"] = -0.1


def _unreachable_name_cap(document: Document) -> None:
    document["desk_limits"]["name_gross_cap"] = 0.01


def _overleveraged_start_book(document: Document) -> None:
    for entry in document["universe"]["names"]:
        entry["start_weight"] = 0.12


def _one_sided_start_book(document: Document) -> None:
    for entry in document["universe"]["names"]:
        entry["start_weight"] = abs(entry["start_weight"])


@pytest.mark.parametrize(
    ("mutate", "fragment"),
    [
        pytest.param(_certain_cvar_beta, "cvar_beta", id="beta-one"),
        pytest.param(_impossible_cvar_beta, "cvar_beta", id="beta-zero"),
        pytest.param(
            _negative_borrow_fee,
            "universe.names.TCH1.borrow_fee_annual",
            id="negative-borrow",
        ),
        pytest.param(
            _negative_half_spread,
            "universe.names.TCH3.half_spread",
            id="negative-spread",
        ),
        pytest.param(_drop_one_name, "universe.names", id="twenty-nine-names"),
        pytest.param(_duplicate_a_name, "universe.names", id="duplicate-name"),
        pytest.param(_add_a_seventh_sector, "universe.sectors", id="seven-sectors"),
        pytest.param(
            _move_a_name_between_sectors, "universe.sectors", id="short-sector"
        ),
        pytest.param(
            _invert_the_net_exposure_band,
            "desk_limits.net_exposure_min",
            id="inverted-net-band",
        ),
        pytest.param(_invert_the_beta_band, "desk_limits.beta_min", id="inverted-beta"),
        pytest.param(
            _zero_gross_leverage, "desk_limits.gross_leverage_max", id="zero-gross"
        ),
        pytest.param(
            _negative_turnover_budget,
            "desk_limits.turnover_max",
            id="negative-turnover",
        ),
        pytest.param(
            _unreachable_name_cap, "desk_limits.name_gross_cap", id="unreachable-cap"
        ),
        pytest.param(
            _overleveraged_start_book, "universe.start_book", id="start-book-gross"
        ),
        pytest.param(
            _one_sided_start_book, "universe.start_book", id="start-book-net-and-beta"
        ),
    ],
)
def test_the_loader_rejects_an_invalid_universe_or_mandate(
    load_mutated: MutatedLoader, mutate: Mutation, fragment: str
) -> None:
    with pytest.raises(ScenarioError) as raised:
        load_mutated(mutate)

    assert fragment in str(raised.value)


def test_the_unreachable_name_cap_message_explains_the_arithmetic(
    load_mutated: MutatedLoader,
) -> None:
    """A gross cap no book can reach is a silent modelling error, not a typo.

    With 30 names capped at 0.01 each, the book cannot hold more than 0.30
    of gross, so a 1.40 gross budget could never bind and every result about
    leverage would be meaningless. The message has to say that, not just
    name the field.
    """
    with pytest.raises(ScenarioError) as raised:
        load_mutated(_unreachable_name_cap)

    message = str(raised.value)
    assert "unreachable" in message
    assert "gross_leverage_max" in message


def test_a_start_book_breach_reports_every_limit_it_breaks(
    load_mutated: MutatedLoader,
) -> None:
    with pytest.raises(ScenarioError) as raised:
        load_mutated(_overleveraged_start_book)

    message = str(raised.value)
    assert "gross" in message
    assert "net" in message
