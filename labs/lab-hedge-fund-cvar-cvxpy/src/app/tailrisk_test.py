"""Behaviour tests for the pure-NumPy tail-risk primitives."""

from __future__ import annotations

import numpy as np
import pytest

from app.contracts import FloatArray
from app.errors import MarketError, ScenarioError
from app.tailrisk import (
    array_digest,
    portfolio_losses,
    tail_statistics,
    weight_distance,
)


def test_tail_statistics_on_a_hand_countable_loss_vector() -> None:
    losses = np.array([-3.0, -1.0, 0.0, 2.0, 4.0, 5.0, 7.0, 9.0, 11.0, 20.0])

    stats = tail_statistics(losses, beta=0.8)

    assert stats.tail_count == 2
    assert stats.var == pytest.approx(11.0)
    assert stats.cvar == pytest.approx(15.5)


def test_tail_statistics_ignores_the_order_the_losses_arrive_in() -> None:
    losses = np.array([20.0, 4.0, -3.0, 11.0, 0.0, 9.0, 5.0, -1.0, 7.0, 2.0])

    stats = tail_statistics(losses, beta=0.8)

    assert stats.var == pytest.approx(11.0)
    assert stats.cvar == pytest.approx(15.5)


def test_tail_statistics_keeps_at_least_one_scenario_in_the_tail() -> None:
    losses = np.arange(10, dtype=np.float64)

    stats = tail_statistics(losses, beta=0.999)

    assert stats.tail_count == 1
    assert stats.var == pytest.approx(9.0)
    assert stats.cvar == pytest.approx(9.0)


def test_cvar_is_never_below_var() -> None:
    rng = np.random.default_rng(11)
    losses = rng.standard_normal(2_000)

    stats = tail_statistics(losses, beta=0.95)

    assert stats.cvar >= stats.var


@pytest.mark.parametrize("beta", [0.0, 1.0, -0.1, 1.5])
def test_tail_statistics_rejects_a_confidence_level_outside_the_open_unit_interval(
    beta: float,
) -> None:
    with pytest.raises(ScenarioError, match="cvar_beta"):
        tail_statistics(np.arange(10, dtype=np.float64), beta=beta)


def test_tail_statistics_rejects_an_empty_sample() -> None:
    with pytest.raises(MarketError, match="losses"):
        tail_statistics(np.array([], dtype=np.float64), beta=0.95)


def test_portfolio_losses_is_the_negated_return_projection() -> None:
    returns = np.array([[0.10, -0.20], [-0.05, 0.04]])
    weights = np.array([1.0, -0.5])

    assert portfolio_losses(returns, weights) == pytest.approx([-0.20, 0.07])


def test_portfolio_losses_uses_the_whole_fixture_matrix(
    tiny_returns: FloatArray,
) -> None:
    weights = np.array([0.5, 0.5])

    losses = portfolio_losses(tiny_returns, weights)

    assert losses == pytest.approx([0.05, 0.005, -0.02, 0.07])


def test_portfolio_losses_rejects_a_weight_vector_of_the_wrong_width(
    tiny_returns: FloatArray,
) -> None:
    with pytest.raises(MarketError, match="weights"):
        portfolio_losses(tiny_returns, np.array([1.0, 0.0, 0.0]))


def test_weight_distance_sums_absolute_per_name_differences() -> None:
    left = np.array([0.10, -0.20, 0.30])
    right = np.array([0.05, -0.10, 0.30])

    assert weight_distance(left, right) == pytest.approx(0.15)


def test_weight_distance_rejects_mismatched_shapes() -> None:
    with pytest.raises(MarketError, match="shape"):
        weight_distance(np.array([1.0, 2.0]), np.array([1.0, 2.0, 3.0]))


def test_array_digest_separates_value_and_shape() -> None:
    flat = np.arange(6, dtype=np.float64)

    assert array_digest(flat) == array_digest(np.arange(6, dtype=np.float64))
    assert array_digest(flat) != array_digest(flat.reshape(2, 3))
    assert array_digest(flat) != array_digest(flat + 1.0)


def test_array_digest_ignores_how_the_array_is_laid_out_in_memory() -> None:
    column_major = np.asfortranarray(np.arange(6, dtype=np.float64).reshape(2, 3))

    assert array_digest(column_major) == array_digest(
        np.arange(6, dtype=np.float64).reshape(2, 3)
    )
