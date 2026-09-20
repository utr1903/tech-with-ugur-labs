"""Behaviour tests for the seeded market generator.

The distribution-shape tests draw 200,000 scenarios each, which is
deliberate: the whole claim of the lab is that one mode has heavy, skewed
loss tails and the other does not, and a sample small enough to be cheap is
too small to tell them apart. They are module-scoped so the draws happen
once. Every other test here runs on a few hundred scenarios.

`scipy` is a development dependency only. It is used here, never in `app`.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
import scipy.stats as stats

from app.contracts import FloatArray, GeneratorSettings, MarketScenarios, Universe
from app.errors import MarketError
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.tailrisk import portfolio_losses

LARGE_SAMPLE = 200_000
SMALL_SAMPLE = 512


def _equal_weight(universe: Universe) -> FloatArray:
    """Return the equal-weighted long-only book over the whole universe."""
    return np.full(len(universe.names), 1.0 / len(universe.names))


def _correlation(returns: FloatArray) -> FloatArray:
    """Return the sample correlation matrix of a `[S, N]` return matrix."""
    covariance = np.cov(returns, rowvar=False)
    scale = np.sqrt(np.outer(np.diag(covariance), np.diag(covariance)))
    return covariance / scale


@pytest.fixture(scope="module")
def large_fat_tailed(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> MarketScenarios:
    """Draw one large fat-tailed sample, shared by the shape tests."""
    return generate_scenarios(
        universe,
        generator_settings,
        seed=3,
        count=LARGE_SAMPLE,
        mode="fat_tailed",
        log=log,
    )


@pytest.fixture(scope="module")
def large_gaussian(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> MarketScenarios:
    """Draw the matching large control sample from the same seed."""
    return generate_scenarios(
        universe,
        generator_settings,
        seed=3,
        count=LARGE_SAMPLE,
        mode="gaussian",
        log=log,
    )


def test_the_same_seed_reproduces_an_identical_matrix(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    first = generate_scenarios(
        universe,
        generator_settings,
        seed=7,
        count=SMALL_SAMPLE,
        mode="fat_tailed",
        log=log,
    )
    second = generate_scenarios(
        universe,
        generator_settings,
        seed=7,
        count=SMALL_SAMPLE,
        mode="fat_tailed",
        log=log,
    )

    assert first.digest == second.digest
    assert np.array_equal(first.returns, second.returns)
    assert first.returns.shape == (SMALL_SAMPLE, len(universe.names))
    assert not first.returns.flags.writeable


def test_a_different_seed_changes_the_matrix(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    first = generate_scenarios(
        universe,
        generator_settings,
        seed=7,
        count=SMALL_SAMPLE,
        mode="fat_tailed",
        log=log,
    )
    second = generate_scenarios(
        universe,
        generator_settings,
        seed=8,
        count=SMALL_SAMPLE,
        mode="fat_tailed",
        log=log,
    )

    assert first.digest != second.digest


def test_the_two_modes_draw_different_matrices_from_one_seed(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    fat = generate_scenarios(
        universe,
        generator_settings,
        seed=7,
        count=SMALL_SAMPLE,
        mode="fat_tailed",
        log=log,
    )
    gaussian = generate_scenarios(
        universe,
        generator_settings,
        seed=7,
        count=SMALL_SAMPLE,
        mode="gaussian",
        log=log,
    )

    assert fat.digest != gaussian.digest
    assert fat.mode == "fat_tailed"
    assert gaussian.mode == "gaussian"


def test_gaussian_mode_has_a_thin_left_tail_and_fat_tailed_mode_does_not(
    universe: Universe,
    large_fat_tailed: MarketScenarios,
    large_gaussian: MarketScenarios,
) -> None:
    equal_weight = _equal_weight(universe)
    gaussian_losses = portfolio_losses(large_gaussian.returns, equal_weight)
    fat_losses = portfolio_losses(large_fat_tailed.returns, equal_weight)

    assert stats.kurtosis(gaussian_losses) == pytest.approx(0.0, abs=0.15)
    assert stats.skew(gaussian_losses) == pytest.approx(0.0, abs=0.05)
    assert stats.kurtosis(fat_losses) > 1.0
    assert stats.skew(fat_losses) > 0.25


def test_gaussian_mode_matches_the_fat_tailed_first_two_moments(
    large_fat_tailed: MarketScenarios, large_gaussian: MarketScenarios
) -> None:
    # Per-name means agree to 1e-3 and standard deviations to 5%. The mean
    # tolerance cannot be much tighter than this: a name whose monthly
    # standard deviation is 0.077 has a standard error of 1.7e-4 on its
    # sample mean at 200,000 draws, so two independent samples routinely sit
    # several of those apart. What is exact is the closed form, which
    # `market_moments_test.py` checks both samples against.
    fat = large_fat_tailed.returns
    gaussian = large_gaussian.returns

    assert np.abs(fat.mean(axis=0) - gaussian.mean(axis=0)).max() < 1e-3
    assert np.abs(fat.std(axis=0) / gaussian.std(axis=0) - 1.0).max() < 0.05


def test_both_modes_share_one_covariance_matrix(
    large_fat_tailed: MarketScenarios, large_gaussian: MarketScenarios
) -> None:
    """The control matches the whole covariance, not only the diagonal.

    This is the premise the elliptical study rests on and nothing else
    asserts it. The market factor and the style factors keep their loadings
    across both modes and the jump term is independent per name, so every
    off-diagonal entry is `beta_i * beta_j * Var(f)` plus the shared style
    term in either mode. If a future edit to the Gaussian draw broke that —
    by rescaling a factor, or by folding the jump into a shared term — the
    two modes would stop differing only in tail shape and the lab's central
    comparison would quietly become unfair.
    """
    fat_covariance = np.cov(large_fat_tailed.returns, rowvar=False)
    gaussian_covariance = np.cov(large_gaussian.returns, rowvar=False)
    off_diagonal = ~np.eye(fat_covariance.shape[0], dtype=bool)

    assert np.abs(fat_covariance - gaussian_covariance).max() < 2.5e-4
    assert np.abs(fat_covariance[off_diagonal]).min() > 0.0
    assert (
        np.abs(
            fat_covariance[off_diagonal] / gaussian_covariance[off_diagonal] - 1.0
        ).max()
        < 0.08
    )
    correlation_gap = np.abs(
        _correlation(large_fat_tailed.returns) - _correlation(large_gaussian.returns)
    )
    assert correlation_gap.max() < 0.03


def test_generate_scenarios_rejects_an_unknown_mode(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    with pytest.raises(MarketError, match="market.mode"):
        generate_scenarios(
            universe, generator_settings, seed=1, count=128, mode="lognormal", log=log
        )


def test_generate_scenarios_rejects_a_non_positive_count(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    with pytest.raises(MarketError, match="count"):
        generate_scenarios(
            universe, generator_settings, seed=1, count=0, mode="fat_tailed", log=log
        )


def test_generate_scenarios_rejects_a_jump_name_outside_the_universe(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    settings = replace(generator_settings, jump_names=("NOPE",))

    with pytest.raises(MarketError, match="jump_names"):
        generate_scenarios(
            universe, settings, seed=1, count=128, mode="fat_tailed", log=log
        )
