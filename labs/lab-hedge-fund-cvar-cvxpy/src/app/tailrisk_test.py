"""Behaviour tests for the pure-NumPy tail-risk primitives."""

from __future__ import annotations

import numpy as np
import pytest

from app.contracts import FloatArray
from app.errors import MarketError, ScenarioError
from app.tailrisk import (
    array_digest,
    portfolio_losses,
    tail_count,
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


def test_a_high_confidence_level_narrows_the_tail_to_the_worst_scenario() -> None:
    """`ceil` rounds a fractional tail up, so the tail is never empty.

    At `beta = 0.999` over ten scenarios the tail is `ceil(0.01) = 1`
    scenario: the single worst loss. VaR and CVaR then coincide, which is
    the degenerate end of the "CVaR averages everything beyond VaR" story.
    """
    losses = np.arange(10, dtype=np.float64)

    stats = tail_statistics(losses, beta=0.999)

    assert stats.tail_count == 1
    assert stats.var == pytest.approx(9.0)
    assert stats.cvar == pytest.approx(9.0)


def test_the_tail_count_is_the_ceiling_of_the_excluded_share() -> None:
    losses = np.arange(1_000, dtype=np.float64)

    assert tail_statistics(losses, beta=0.95).tail_count == 50
    assert tail_statistics(losses, beta=0.9501).tail_count == 50
    assert tail_statistics(losses, beta=0.9499).tail_count == 51


def test_a_whole_number_tail_share_survives_binary_floating_point() -> None:
    """A 95% tail of 10,000 scenarios holds 500 of them, not 501.

    `1 - 0.95` is `0.05000000000000004` in binary, so the naive ceiling of
    the product overshoots by one whole scenario. The lab's model-versus-
    empirical agreement check is asserted to `tolerances.cvar_agreement_abs`,
    5.0e-9 as shipped, and one extra scenario in a 500-long tail moves that
    average by about 1e-04 — five orders past the ceiling. So the slip would
    fail the check, and would read as a solver problem rather than as the
    arithmetic one it is.
    """
    assert (1.0 - 0.95) * 10_000 > 500.0

    assert tail_statistics(
        np.arange(10_000, dtype=np.float64), beta=0.95
    ).tail_count == (500)
    assert tail_statistics(
        np.arange(4_000, dtype=np.float64), beta=0.95
    ).tail_count == (200)


def test_a_tail_share_too_small_to_round_still_keeps_one_scenario() -> None:
    losses = np.arange(100, dtype=np.float64)

    stats = tail_statistics(losses, beta=1.0 - 1e-12)

    assert stats.tail_count == 1
    assert stats.var == pytest.approx(99.0)


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


def test_array_digest_separates_two_precisions_of_the_same_values() -> None:
    """The same numbers at a different precision are a different matrix.

    The digest is what the lab prints to claim one run reproduced another.
    Hashing only the bytes would make a float32 matrix collide or not
    depending on padding, so the dtype is hashed alongside them.
    """
    double = np.arange(6, dtype=np.float64)
    single = np.arange(6, dtype=np.float32)

    assert array_digest(double) != array_digest(single)


def test_array_digest_ignores_how_the_array_is_laid_out_in_memory() -> None:
    column_major = np.asfortranarray(np.arange(6, dtype=np.float64).reshape(2, 3))

    assert array_digest(column_major) == array_digest(
        np.arange(6, dtype=np.float64).reshape(2, 3)
    )


def test_the_tail_count_survives_binary_floating_point_at_every_lab_size() -> None:
    """The one arithmetic slip this module exists to prevent.

    `(1 - 0.95) * 10000` is `500.00000000000045` in binary floating point,
    so a plain `ceil` returns 501. Every size the lab runs at is affected,
    and each extra scenario in the tail would quietly break the claim that
    the linear program's optimum is the average of the worst `k` losses.
    """
    assert tail_count(500, 0.95) == 25
    assert tail_count(4_000, 0.95) == 200
    assert tail_count(10_000, 0.95) == 500
    assert tail_count(25_000, 0.95) == 1_250


def test_a_genuinely_fractional_tail_still_rounds_up() -> None:
    """Snapping only removes representation error, not real fractions."""
    assert tail_count(590, 0.95) == 30
    assert tail_count(101, 0.95) == 6


def test_the_tail_count_rejects_an_empty_sample_and_a_bad_confidence_level() -> None:
    with pytest.raises(MarketError, match="scenario count must be positive"):
        tail_count(0, 0.95)
    with pytest.raises(ScenarioError, match="cvar_beta"):
        tail_count(100, 1.0)
