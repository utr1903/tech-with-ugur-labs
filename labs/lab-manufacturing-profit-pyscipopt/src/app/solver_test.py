"""Boundary tests for solver metadata and incumbent extraction."""

from __future__ import annotations

from typing import override

from pyscipopt import Model

from app.logging_setup import Logger
from app.model import BuiltModel, build_model
from app.scenario import Scenario, SolverSettings
from app.solver import solve_model


class NoExtractionModel(Model):
    """A real empty SCIP model whose extraction method must remain untouched."""

    @override
    def getNSols(self) -> int:
        """Report the zero-incumbent condition this boundary test exercises."""
        return 0

    @override
    def getBestSol(self) -> None:
        """Fail loudly if solve_model asks for a solution when none exists."""
        raise AssertionError("solution extraction was attempted")


def test_no_incumbent_never_attempts_extraction(
    scenario: Scenario, log: Logger
) -> None:
    """Zero-solution metadata returns safely without touching solution methods."""
    variables = build_model(scenario, log=log).variables
    built = BuiltModel(model=NoExtractionModel(), variables=variables)

    result = solve_model(
        built,
        SolverSettings(time_limit_seconds=10.0, relative_gap=0.0),
        log=log,
    )

    assert result.decisions is None
    assert result.objective_usd is None
    assert result.relative_gap is None
