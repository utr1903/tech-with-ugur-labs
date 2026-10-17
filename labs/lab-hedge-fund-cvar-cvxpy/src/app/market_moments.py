"""The closed-form moments of the factor model, derived rather than sampled.

This module is the algebra behind `market.py`. Every number here is written
out analytically, which is what lets the lab claim its two market modes
share their first two moments *exactly* rather than approximately: the
Gaussian control is parameterized from these formulas, not fitted to a
sample of the fat-tailed one.

It is also the module the scenario loader leans on. `Universe.expected_return`
is `alpha_monthly + market_beta * market_factor_mean`, so the file a reader
edits and the matrix the generator draws cannot drift apart.

Nothing here draws a random number.
"""

from __future__ import annotations

import math

import numpy as np

from app.contracts import (
    FloatArray,
    GeneratorSettings,
    IntArray,
    Universe,
    frozen_float_array,
)
from app.errors import MarketError

# Style factors are deliberately a secondary source of co-movement next to
# the market factor, so their scale is pinned to a fixed fraction of the
# calm market sigma rather than given a scenario field of its own.
STYLE_SIGMA_FRACTION = 0.5

# How strongly a name loads on its own sector's style factor and on the
# next one, which is what makes neighbouring sectors co-move.
OWN_FACTOR_LOADING = 0.6
NEXT_FACTOR_LOADING = 0.2


def style_sigma(settings: GeneratorSettings) -> float:
    """Return the standard deviation of one style factor.

    Both draws and the closed form call this rather than repeating the
    multiplication. If the fat-tailed draw, the Gaussian draw and
    `matched_gaussian_moments` ever disagreed about this number, the two
    modes would stop sharing a covariance matrix and the lab's elliptical
    control would quietly stop being a control.
    """
    return settings.calm_sigma * STYLE_SIGMA_FRACTION


def market_factor_moments(settings: GeneratorSettings) -> tuple[float, float]:
    """Return the closed-form mean and standard deviation of the market factor.

    The factor is a two-component mixture: with probability `p` the month is
    a stress month drawn from `N(stress_mean, stress_sigma**2)`, otherwise a
    calm month drawn from `N(0, calm_sigma**2)`. For a mixture the mean is
    the weighted mean and the second moment is the weighted second moment,
    so

        mean = p * stress_mean
        var  = (1 - p) * calm_sigma**2
             + p * (stress_sigma**2 + stress_mean**2)
             - mean**2

    Because `stress_mean` is negative the market drifts slightly down, which
    puts a name's expected return below its alpha by `beta * |mean|`.
    """
    probability = settings.stress_probability
    mean = probability * settings.stress_mean
    second = (1.0 - probability) * settings.calm_sigma**2 + probability * (
        settings.stress_sigma**2 + settings.stress_mean**2
    )
    return mean, math.sqrt(max(second - mean**2, 0.0))


def jump_moments(settings: GeneratorSettings) -> tuple[float, float]:
    """Return the closed-form mean and standard deviation of one name's jump.

    A jump is a Bernoulli-normal mixture: with probability `q` the name takes
    an extra `N(jump_mean, jump_sigma**2)` shock, otherwise nothing. The same
    mixture algebra as the market factor gives

        mean = q * jump_mean
        var  = q * (jump_sigma**2 + jump_mean**2) - mean**2

    Note how differently the two terms scale in `|jump_mean|`: the mean, and
    with it the tail, grows linearly while the variance grows quadratically.
    That gap is why a rare, large, one-sided jump is nearly invisible to a
    variance model and impossible for a CVaR model to ignore.
    """
    probability = settings.jump_probability
    mean = probability * settings.jump_mean
    variance = probability * (settings.jump_sigma**2 + settings.jump_mean**2) - mean**2
    return mean, math.sqrt(max(variance, 0.0))


def jump_columns(universe: Universe, settings: GeneratorSettings) -> IntArray:
    """Return the universe positions of the names that carry jumps.

    Raises:
        MarketError: If `jump_names` mentions a name the universe lacks.
    """
    positions = {name: index for index, name in enumerate(universe.names)}
    missing = [name for name in settings.jump_names if name not in positions]
    if missing:
        raise MarketError(f"market.jump_names refers to unknown names: {missing}")
    columns = sorted(positions[name] for name in settings.jump_names)
    return np.array(columns, dtype=np.int64)


def style_loadings(universe: Universe, factor_count: int) -> FloatArray:
    """Build the `[N, factor_count]` style loading matrix from sector membership.

    Sector `k` loads on style factor `k % factor_count` and, more weakly, on
    the next one, so sectors that share a factor move together. The matrix is
    derived here rather than configured, which saves the scenario file from
    having to spell out a 30-by-3 grid by hand.
    """
    sector_of = universe.sector_of
    rows = np.arange(sector_of.shape[0])
    loadings = np.zeros((sector_of.shape[0], factor_count), dtype=np.float64)
    loadings[rows, sector_of % factor_count] = OWN_FACTOR_LOADING
    loadings[rows, (sector_of + 1) % factor_count] = NEXT_FACTOR_LOADING
    return loadings


def alpha_from_expected_return(
    universe: Universe, settings: GeneratorSettings
) -> FloatArray:
    """Recover the per-name alpha the loader folded into `expected_return`.

    The loader stores `expected_return = alpha + beta * market_mean` so that
    the scenario file and the generator cannot drift apart. The generator
    needs the alpha back, and subtracting the same closed-form market mean
    is what guarantees the round trip is exact.
    """
    market_mean, _ = market_factor_moments(settings)
    return universe.expected_return - universe.market_beta * market_mean


def matched_gaussian_moments(
    settings: GeneratorSettings, universe: Universe
) -> tuple[FloatArray, FloatArray]:
    """Return the closed-form per-name mean and standard deviation of a return.

    These are the moments of the `fat_tailed` mode, computed analytically
    rather than by sampling, and they are exactly what the `gaussian` mode
    reproduces. Every component is independent, so the variances add:

        mean[i] = alpha[i] + beta[i] * market_mean + jump_mean_i
        var[i]  = beta[i]**2 * market_var
                + sum_k L[i, k]**2 * style_sigma**2
                + idiosyncratic_sigma**2
                + jump_var_i

    where `jump_mean_i` and `jump_var_i` are zero for every name outside
    `jump_names`. The Student-t shock is rescaled to unit variance before
    being multiplied by `idiosyncratic_sigma`, so it contributes
    `idiosyncratic_sigma**2` in either mode.

    Because the shared components — the market factor and the style factors —
    keep their loadings in both modes, and the jump term is independent per
    name, matching these per-name moments matches the whole covariance
    matrix, not just its diagonal. That is what makes the Gaussian mode a
    fair elliptical control rather than merely a similarly-sized one.
    """
    _, market_sigma = market_factor_moments(settings)
    jump_mean, jump_sigma = jump_moments(settings)
    columns = jump_columns(universe, settings)
    loadings = style_loadings(universe, settings.factor_count)

    means = np.array(universe.expected_return, dtype=np.float64)
    means[columns] += jump_mean
    variances = (
        universe.market_beta**2 * market_sigma**2
        + (loadings**2).sum(axis=1) * style_sigma(settings) ** 2
        + settings.idiosyncratic_sigma**2
    )
    variances[columns] += jump_sigma**2
    return frozen_float_array(means), frozen_float_array(np.sqrt(variances))
