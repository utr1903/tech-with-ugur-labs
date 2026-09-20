"""Behaviour tests for the closed-form moments of the factor model."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from app.contracts import GeneratorSettings, Universe
from app.errors import MarketError
from app.logging_setup import Logger
from app.market import generate_scenarios
from app.market_moments import (
    NEXT_FACTOR_LOADING,
    OWN_FACTOR_LOADING,
    jump_columns,
    jump_moments,
    market_factor_moments,
    matched_gaussian_moments,
    style_loadings,
    style_sigma,
)

# A 500-scenario sample is visibly off the closed form; a 50,000-scenario
# one is not. The two thresholds below sit between the measured errors
# (0.064 and 0.0063 on standard deviations, 6.1e-3 and 5.4e-4 on means).
_SMALL_SAMPLE = 500
_LARGE_SAMPLE = 50_000
_SIGMA_GAP = 0.02
_MEAN_GAP = 2e-3


def test_the_closed_form_moments_do_not_move_with_the_sample(
    universe: Universe, generator_settings: GeneratorSettings, log: Logger
) -> None:
    """The helper derives its moments; it does not fit them to a draw.

    This is the property the whole Gaussian control rests on. A helper that
    measured a sample and rescaled it would track whatever sample it was
    given — so the test draws two wildly different samples, from different
    seeds and two orders of magnitude apart in size, and shows that both
    converge *towards* one fixed pair of numbers rather than the numbers
    moving towards them.
    """
    closed_mean, closed_sigma = matched_gaussian_moments(generator_settings, universe)

    small = generate_scenarios(
        universe,
        generator_settings,
        seed=11,
        count=_SMALL_SAMPLE,
        mode="gaussian",
        log=log,
    )
    large = generate_scenarios(
        universe,
        generator_settings,
        seed=12,
        count=_LARGE_SAMPLE,
        mode="gaussian",
        log=log,
    )

    repeated_mean, repeated_sigma = matched_gaussian_moments(
        generator_settings, universe
    )
    assert np.array_equal(repeated_mean, closed_mean)
    assert np.array_equal(repeated_sigma, closed_sigma)

    small_sigma_error = np.abs(small.returns.std(axis=0) / closed_sigma - 1.0).max()
    large_sigma_error = np.abs(large.returns.std(axis=0) / closed_sigma - 1.0).max()
    assert small_sigma_error > _SIGMA_GAP > large_sigma_error

    small_mean_error = np.abs(small.returns.mean(axis=0) - closed_mean).max()
    large_mean_error = np.abs(large.returns.mean(axis=0) - closed_mean).max()
    assert small_mean_error > _MEAN_GAP > large_mean_error


def test_only_the_jump_carriers_gain_variance_from_the_jump_channel(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    """Switching the jumps off changes the carriers' moments and nobody else's.

    The comparison is each name against itself with `jump_probability` set
    to zero, rather than carriers against non-carriers. A cross-name
    comparison would be wrong: ENE5 carries no jumps but has a beta of 1.34,
    which makes it more volatile than the carrier HLC2 at a beta of 0.82.
    Volatility ranks names by beta; the jump channel is a separate axis.
    """
    jump_mean, _ = jump_moments(generator_settings)
    quiet_settings = replace(generator_settings, jump_probability=0.0)
    carriers = jump_columns(universe, generator_settings)
    others = np.setdiff1d(np.arange(len(universe.names)), carriers)

    with_jumps_mean, with_jumps_sigma = matched_gaussian_moments(
        generator_settings, universe
    )
    without_mean, without_sigma = matched_gaussian_moments(quiet_settings, universe)

    assert np.array_equal(with_jumps_sigma[others], without_sigma[others])
    assert np.array_equal(with_jumps_mean[others], without_mean[others])
    assert np.all(with_jumps_sigma[carriers] > without_sigma[carriers])
    assert with_jumps_mean[carriers] == pytest.approx(
        without_mean[carriers] + jump_mean
    )

    # Variances add in quadrature, so a jump component with a standard
    # deviation of 0.0317 lifts a carrier's total monthly sigma by well
    # under a percentage point. That small a move in volatility, and this
    # large a move in the tail, is the whole experiment.
    lift = with_jumps_sigma[carriers] - without_sigma[carriers]
    assert lift.min() > 0.006
    assert lift.max() < 0.009


def test_the_matched_mean_is_the_expected_return_plus_the_jump_drift(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    jump_mean, _ = jump_moments(generator_settings)
    carriers = jump_columns(universe, generator_settings)
    others = np.setdiff1d(np.arange(len(universe.names)), carriers)
    closed_mean, _ = matched_gaussian_moments(generator_settings, universe)

    assert closed_mean[others] == pytest.approx(universe.expected_return[others])
    assert closed_mean[carriers] == pytest.approx(
        universe.expected_return[carriers] + jump_mean
    )
    assert not closed_mean.flags.writeable


def test_a_jumpless_setting_has_no_jump_moments(
    generator_settings: GeneratorSettings,
) -> None:
    mean, sigma = jump_moments(replace(generator_settings, jump_probability=0.0))

    assert mean == 0.0
    assert sigma == 0.0


def test_a_calm_only_market_keeps_the_calm_sigma(
    generator_settings: GeneratorSettings,
) -> None:
    mean, sigma = market_factor_moments(
        replace(generator_settings, stress_probability=0.0)
    )

    assert mean == 0.0
    assert sigma == pytest.approx(generator_settings.calm_sigma)


def test_the_stress_regime_drags_the_market_mean_below_zero(
    generator_settings: GeneratorSettings,
) -> None:
    mean, sigma = market_factor_moments(generator_settings)

    assert mean < 0.0
    assert sigma > generator_settings.calm_sigma


def test_style_loadings_tie_every_name_to_its_own_sector_and_the_next(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    factor_count = generator_settings.factor_count
    loadings = style_loadings(universe, factor_count)

    assert loadings.shape == (len(universe.names), factor_count)
    for index, sector in enumerate(universe.sector_of):
        own = int(sector) % factor_count
        neighbour = (int(sector) + 1) % factor_count
        assert loadings[index, own] == pytest.approx(OWN_FACTOR_LOADING)
        assert loadings[index, neighbour] == pytest.approx(NEXT_FACTOR_LOADING)
        assert loadings[index].sum() == pytest.approx(
            OWN_FACTOR_LOADING + NEXT_FACTOR_LOADING
        )


def test_names_in_the_same_sector_share_a_style_loading_row(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    loadings = style_loadings(universe, generator_settings.factor_count)
    first_technology = int(np.flatnonzero(universe.sector_of == 0)[0])
    last_technology = int(np.flatnonzero(universe.sector_of == 0)[-1])
    first_healthcare = int(np.flatnonzero(universe.sector_of == 1)[0])

    assert np.array_equal(loadings[first_technology], loadings[last_technology])
    assert not np.array_equal(loadings[first_technology], loadings[first_healthcare])


def test_style_sigma_is_a_fixed_fraction_of_the_calm_market_sigma(
    generator_settings: GeneratorSettings,
) -> None:
    assert style_sigma(generator_settings) < generator_settings.calm_sigma
    assert style_sigma(replace(generator_settings, calm_sigma=0.1)) == pytest.approx(
        style_sigma(generator_settings) * 0.1 / generator_settings.calm_sigma
    )


def test_jump_columns_reports_an_unknown_name(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    with pytest.raises(MarketError, match="jump_names"):
        jump_columns(universe, replace(generator_settings, jump_names=("NOPE",)))
