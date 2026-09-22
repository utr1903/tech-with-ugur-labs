"""The seeded factor model that draws the lab's return scenarios.

One month of returns for name `i` in scenario `s` is

    r[s, i] = alpha[i] + beta[i] * f[s] + (g[s] @ L.T)[i] + eps[s, i] + jump[s, i]

with a market factor `f`, `factor_count` style factors `g` whose loadings
`L` are built from sector membership, an idiosyncratic shock `eps` and, for
a named handful of companies, a rare one-sided `jump`.

The model runs in two modes and the contrast between them is the whole
teaching point:

* `fat_tailed` gives the market factor a rare stress regime, draws `eps`
  from a Student-t and adds the jumps. Losses are skewed and heavy-tailed.
* `gaussian` keeps the identical factor structure but replaces the regime
  mixture, the Student-t and the jump mixture with single normals carrying
  the same first two moments. Because the shared factors keep their
  loadings, that matches the whole covariance matrix, so anything the two
  modes disagree about is caused by shape beyond mean and variance.

The closed-form moments both modes are built from live in `market_moments.py`;
reading a reader-supplied history instead of drawing one lives in
`returns_csv.py`. Nothing in any of the three imports CVXPY: the market is
data, and the model is somewhere else.
"""

from __future__ import annotations

import math

import numpy as np

from app.contracts import (
    FloatArray,
    GeneratorSettings,
    MarketScenarios,
    Universe,
    frozen_float_array,
)
from app.errors import MarketError
from app.logging_setup import Logger
from app.market_moments import (
    alpha_from_expected_return,
    jump_columns,
    jump_moments,
    market_factor_moments,
    style_loadings,
    style_sigma,
)
from app.tailrisk import array_digest

FAT_TAILED_MODE = "fat_tailed"
GAUSSIAN_MODE = "gaussian"
MODES = (FAT_TAILED_MODE, GAUSSIAN_MODE)


def _assemble(
    universe: Universe,
    settings: GeneratorSettings,
    factor: FloatArray,
    style: FloatArray,
    shocks: FloatArray,
) -> FloatArray:
    """Combine the drawn components into a `[count, N]` return matrix."""
    loadings = style_loadings(universe, settings.factor_count)
    return (
        alpha_from_expected_return(universe, settings)
        + np.outer(factor, universe.market_beta)
        + style @ loadings.T
        + shocks
    )


def _draw_fat_tailed(
    rng: np.random.Generator,
    universe: Universe,
    settings: GeneratorSettings,
    count: int,
) -> FloatArray:
    """Draw `count` scenarios from the regime-switching, jump-carrying model.

    The draw order — market regime, market levels, style factors,
    idiosyncratic shocks, jump indicators, jump sizes — is fixed, because
    changing it would change every digest the lab prints for a given seed.
    """
    name_count = len(universe.names)
    regime = rng.random(count) < settings.stress_probability
    calm = rng.normal(0.0, settings.calm_sigma, count)
    stress = rng.normal(settings.stress_mean, settings.stress_sigma, count)
    factor = np.where(regime, stress, calm)

    style = rng.normal(0.0, style_sigma(settings), (count, settings.factor_count))

    degrees = settings.idiosyncratic_df
    unit_scale = math.sqrt(degrees / (degrees - 2.0))
    shocks = (
        rng.standard_t(degrees, size=(count, name_count))
        / unit_scale
        * settings.idiosyncratic_sigma
    )

    columns = jump_columns(universe, settings)
    hit = rng.random((count, columns.size)) < settings.jump_probability
    size = rng.normal(settings.jump_mean, settings.jump_sigma, (count, columns.size))
    shocks[:, columns] += np.where(hit, size, 0.0)

    return _assemble(universe, settings, factor, style, shocks)


def _draw_gaussian(
    rng: np.random.Generator,
    universe: Universe,
    settings: GeneratorSettings,
    count: int,
) -> FloatArray:
    """Draw `count` scenarios from the moment-matched elliptical control.

    Same components in the same order as the fat-tailed draw, but each one
    replaced by the single normal with the same first two moments.
    """
    name_count = len(universe.names)
    market_mean, market_sigma = market_factor_moments(settings)
    factor = rng.normal(market_mean, market_sigma, count)

    style = rng.normal(0.0, style_sigma(settings), (count, settings.factor_count))

    shocks = rng.normal(0.0, settings.idiosyncratic_sigma, size=(count, name_count))

    jump_mean, jump_sigma = jump_moments(settings)
    columns = jump_columns(universe, settings)
    shocks[:, columns] += rng.normal(jump_mean, jump_sigma, (count, columns.size))

    return _assemble(universe, settings, factor, style, shocks)


def _require_finite(returns: FloatArray) -> FloatArray:
    """Reject a matrix that a bad parameter turned into NaN or infinity."""
    if not np.all(np.isfinite(returns)):
        raise MarketError("the generated return matrix contains non-finite values")
    return returns


def generate_scenarios(
    universe: Universe,
    settings: GeneratorSettings,
    *,
    seed: int,
    count: int,
    mode: str,
    log: Logger,
) -> MarketScenarios:
    """Draw `count` one-month return scenarios from the seeded factor model.

    `seed`, `count` and `mode` are keyword arguments even though `settings`
    also carries fields of those names. That is deliberate rather than an
    oversight: `settings` supplies the distribution shape, which never varies
    within a run, while the three keywords are the per-call override the
    comparison studies need when they re-draw the same market under many
    seeds, at a different sample size, or in the control mode.

    Args:
        universe: The names, their betas and their expected returns.
        settings: Distribution parameters for every component.
        seed: Seed for this draw.
        count: Number of scenarios, `S`.
        mode: `"fat_tailed"` or `"gaussian"`.
        log: Logger for the operation boundary.

    Returns:
        The `[S, N]` matrix with its mode, seed and digest.

    Raises:
        MarketError: If `mode` is unknown, `count` is not positive, a jump
            name is unknown, or the settings produce a non-finite matrix.
    """
    if mode not in MODES:
        raise MarketError(f"market.mode must be one of {list(MODES)}, got {mode!r}")
    if count <= 0:
        raise MarketError(f"scenario count must be positive, got {count}")

    try:
        log.info("Generating scenarios...", mode=mode, seed=seed, count=count)
        rng = np.random.default_rng(seed)
        draw = _draw_fat_tailed if mode == FAT_TAILED_MODE else _draw_gaussian
        returns = frozen_float_array(
            _require_finite(draw(rng, universe, settings, count))
        )
        scenarios = MarketScenarios(
            returns=returns, mode=mode, seed=seed, digest=array_digest(returns)
        )
    except Exception:
        log.exception("Generating scenarios failed.", mode=mode, seed=seed, count=count)
        raise
    else:
        log.info(
            "Generating scenarios succeeded.",
            mode=mode,
            seed=seed,
            count=count,
            digest=scenarios.digest,
        )
        return scenarios
