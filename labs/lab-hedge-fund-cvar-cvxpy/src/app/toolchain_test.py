"""Proves the pinned stack delivers every algorithm the lab compares."""

from __future__ import annotations

import cvxpy as cp
import numpy as np
import pytest


def test_all_three_algorithms_are_installed() -> None:
    installed = set(cp.installed_solvers())
    assert "CLARABEL" in installed
    assert "HIGHS" in installed


def test_highs_accepts_an_explicit_algorithm_choice() -> None:
    x = cp.Variable(2, nonneg=True)
    problem = cp.Problem(cp.Minimize(cp.sum(x)), [x >= np.array([1.0, 2.0])])
    for algorithm in ("simplex", "ipm"):
        problem.solve(solver=cp.HIGHS, highs_options={"solver": algorithm})
        assert problem.status == cp.OPTIMAL
        assert problem.value == pytest.approx(3.0, abs=1e-9)


def test_sum_largest_is_available_as_a_cvar_oracle() -> None:
    losses = cp.Constant(np.array([1.0, 5.0, 2.0, 9.0]))
    assert float(cp.sum_largest(losses, 2).value) == pytest.approx(14.0)
