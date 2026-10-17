"""Proves the CVXPY facade itself is load-bearing, not just importable."""

from __future__ import annotations

import cvxpy as cp
import numpy as np
import pytest

from app.cvxpy_api import installed_solvers, solve


def test_installed_solvers_reports_clarabel_and_highs() -> None:
    installed = installed_solvers()
    assert isinstance(installed, tuple)
    assert "CLARABEL" in installed
    assert "HIGHS" in installed


def test_solve_reaches_optimal_under_clarabel() -> None:
    x = cp.Variable(2, nonneg=True)
    problem = cp.Problem(cp.Minimize(cp.sum(x)), [x >= np.array([1.0, 2.0])])
    solve(problem, solver=cp.CLARABEL)
    assert problem.status == cp.OPTIMAL
    # Clarabel is an interior-point conic solver, not an exact simplex
    # method, so its reported optimum carries interior-point tolerance.
    assert problem.value == pytest.approx(3.0, abs=1e-6)


def test_solve_reaches_optimal_under_both_highs_algorithms() -> None:
    for algorithm in ("simplex", "ipm"):
        x = cp.Variable(2, nonneg=True)
        problem = cp.Problem(cp.Minimize(cp.sum(x)), [x >= np.array([1.0, 2.0])])
        solve(problem, solver=cp.HIGHS, highs_options={"solver": algorithm})
        assert problem.status == cp.OPTIMAL
        assert problem.value == pytest.approx(3.0, abs=1e-9)
