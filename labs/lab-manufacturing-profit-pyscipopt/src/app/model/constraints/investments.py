"""Start-year capital charges and one-year delayed persistent availability."""

from __future__ import annotations

import numpy as np
from pyscipopt import MatrixExpr, Model

from app.contracts import Scenario
from app.model.variables import ModelVariables


def availability(variables: ModelVariables) -> MatrixExpr:
    """U[i,t] = sum(z[i,tau] for tau < t), dimensionless."""
    result = np.zeros((4, 3), dtype=object).view(MatrixExpr)
    for year in range(1, 3):
        result[:, year] = variables.investment_start[:, :year].sum(axis=1)
    return result


def factory_open(variables: ModelVariables) -> MatrixExpr:
    """Germany is open; China opens one year after its investment start."""
    result = np.ones((2, 3), dtype=object).view(MatrixExpr)
    result[1] = availability(variables)[3]
    return result


def add_investment_constraints(model: Model, v: ModelVariables, s: Scenario) -> None:
    """sum_t z[i,t] <= 1; annual start-year capex <= allowance, in MUSD."""
    model.addMatrixCons(v.investment_start.sum(axis=1) <= 1, name="invest_once")
    model.addMatrixCons(
        (s.investment_cost[:, None] * v.investment_start).sum(axis=0)
        <= s.central_allowance,
        name="central_allowance",
    )
