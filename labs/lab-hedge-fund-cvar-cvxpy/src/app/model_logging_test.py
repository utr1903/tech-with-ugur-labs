"""Checks the build-time log actually describes the model that was built."""

from __future__ import annotations

from collections.abc import MutableMapping, Sequence
from typing import Any

import structlog

from app.contracts import MarketScenarios, Scenario
from app.logging_setup import Logger
from app.model import build_cvar_problem

type Record = MutableMapping[str, Any]


def _events(records: Sequence[Record], event: str) -> list[Record]:
    """Return the captured records whose message is `event`."""
    return [record for record in records if record["event"] == event]


def test_the_build_log_describes_every_variable_and_constraint_family(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """The log is the only readable description of a compiled problem.

    Once a model reaches a solver it is a sparse matrix, so a constraint
    declared with the wrong bound leaves no trace anywhere else. These
    lines are what a reader checks the README's algebra against.
    """
    with structlog.testing.capture_logs() as records:
        build_cvar_problem(small_scenario, small_market, log=log)

    variables = {
        record["name"] for record in _events(records, "Declared a model variable.")
    }
    assert variables == {
        "weights",
        "long_leg",
        "short_leg",
        "turnover_leg",
        "var_auxiliary",
        "tail_shortfall",
    }

    families = {
        record["label"]: record
        for record in _events(records, "Declared a constraint family.")
    }
    assert families["signed_split"]["sense"] == "=="
    assert families["signed_split"]["bound"] is None
    assert families["gross_leverage"]["sense"] == "<="
    assert (
        families["gross_leverage"]["bound"] == small_scenario.limits.gross_leverage_max
    )
    assert families["name_gross_cap"]["shape"] == [len(small_scenario.universe.names)]
    # Only the return target carries the swept parameter; everything else
    # is fixed at build time, which is what keeps the problem DPP.
    parameterized = {
        label for label, record in families.items() if record["is_parameterized"]
    }
    assert parameterized == {"return_target"}


def test_a_nonnegative_variable_is_logged_as_one(
    small_scenario: Scenario, small_market: MarketScenarios, log: Logger
) -> None:
    """`weights` is free and the three legs are not, and the log says so."""
    with structlog.testing.capture_logs() as records:
        build_cvar_problem(small_scenario, small_market, log=log)

    signs = {
        record["name"]: record["is_nonneg"]
        for record in _events(records, "Declared a model variable.")
    }

    assert signs["weights"] is False
    assert signs["var_auxiliary"] is False
    assert signs["long_leg"] is True
    assert signs["short_leg"] is True
    assert signs["turnover_leg"] is True
