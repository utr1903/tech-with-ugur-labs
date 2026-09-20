"""The seeded factor model that produces the lab's return scenarios.

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
  mixture, the Student-t and the jump mixture with single normals chosen to
  reproduce the fat-tailed mode's first two moments exactly, in closed form
  (`matched_gaussian_moments`). Anything the two modes disagree about is
  therefore caused by shape beyond mean and variance, not by size.

Nothing here imports CVXPY: the market is data, and the model is somewhere
else.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from app.contracts import (
    FloatArray,
    GeneratorSettings,
    IntArray,
    MarketScenarios,
    Universe,
    frozen_float_array,
)
from app.errors import MarketError
from app.logging_setup import Logger
from app.tailrisk import array_digest

FAT_TAILED_MODE = "fat_tailed"
GAUSSIAN_MODE = "gaussian"
MODES = (FAT_TAILED_MODE, GAUSSIAN_MODE)
CSV_MODE = "returns_csv"

# Style factors are deliberately a secondary source of co-movement next to
# the market factor, so their scale is pinned to a fixed fraction of the
# calm market sigma rather than given a scenario field of its own.
STYLE_SIGMA_FRACTION = 0.5

# How strongly a name loads on its own sector's style factor and on the
# next one, which is what makes neighbouring sectors co-move.
OWN_FACTOR_LOADING = 0.6
NEXT_FACTOR_LOADING = 0.2


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


def _alpha(universe: Universe, settings: GeneratorSettings) -> FloatArray:
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
    """
    _, market_sigma = market_factor_moments(settings)
    jump_mean, jump_sigma = jump_moments(settings)
    columns = jump_columns(universe, settings)
    loadings = style_loadings(universe, settings.factor_count)
    style_sigma = settings.calm_sigma * STYLE_SIGMA_FRACTION

    means = np.array(universe.expected_return, dtype=np.float64)
    means[columns] += jump_mean
    variances = (
        universe.market_beta**2 * market_sigma**2
        + (loadings**2).sum(axis=1) * style_sigma**2
        + settings.idiosyncratic_sigma**2
    )
    variances[columns] += jump_sigma**2
    return frozen_float_array(means), frozen_float_array(np.sqrt(variances))


def _assemble(
    universe: Universe,
    settings: GeneratorSettings,
    factor: FloatArray,
    style: FloatArray,
    shocks: FloatArray,
) -> FloatArray:
    """Combine the drawn components into a `[count, N]` return matrix."""
    loadings = style_loadings(universe, settings.factor_count)
    beta = universe.market_beta
    return (
        _alpha(universe, settings)
        + np.outer(factor, beta)
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

    style_sigma = settings.calm_sigma * STYLE_SIGMA_FRACTION
    style = rng.normal(0.0, style_sigma, size=(count, settings.factor_count))

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

    style_sigma = settings.calm_sigma * STYLE_SIGMA_FRACTION
    style = rng.normal(0.0, style_sigma, size=(count, settings.factor_count))

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


def _require_header(header: list[str], names: tuple[str, ...]) -> None:
    """Reject a header that is not exactly the universe's columns, in order."""
    if tuple(header) != names:
        raise MarketError(
            f"the header row must name every universe column in order: expected "
            f"{len(names)} columns starting {names[:3]}, got {len(header)} columns "
            f"starting {tuple(header[:3])}"
        )


def _parse_row(row: list[str], names: tuple[str, ...], line: int) -> list[float]:
    """Convert one data row into floats, naming the offending column."""
    if len(row) != len(names):
        raise MarketError(
            f"row {line} holds {len(row)} values but the header declares "
            f"{len(names)} columns"
        )
    values: list[float] = []
    for column, cell in enumerate(row):
        try:
            values.append(float(cell))
        except ValueError as err:
            raise MarketError(
                f"row {line}, column {names[column]!r} is not a number: {cell!r}"
            ) from err
    return values


def _read_returns(path: Path, names: tuple[str, ...]) -> FloatArray:
    """Read a whole return-history file into a `[periods, N]` matrix."""
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        raise MarketError(f"{path} is empty")
    _require_header([cell.strip() for cell in rows[0]], names)
    values = [
        _parse_row(row, names, line) for line, row in enumerate(rows[1:], start=2)
    ]
    if not values:
        raise MarketError(f"{path} has a header row but no return rows")
    return frozen_float_array(values)


def load_returns_csv(path: Path, universe: Universe, *, log: Logger) -> MarketScenarios:
    """Load a reader-supplied return history instead of generating one.

    The file starts with a header row naming exactly the universe's names, in
    the universe's order, followed by one row of simple one-month returns per
    historical period. The strict header is deliberate: silently reordering
    columns would misprice every short in the book.

    Args:
        path: The CSV file to read.
        universe: The universe whose column order the file must match.
        log: Logger for the operation boundary.

    Returns:
        The loaded matrix, tagged with mode `"returns_csv"` and seed `0`.

    Raises:
        MarketError: If the file is unreadable, the header does not match, or
            a row is the wrong width or not numeric.
    """
    try:
        log.info("Loading return history...", path=str(path))
        returns = _read_returns(path, universe.names)
        scenarios = MarketScenarios(
            returns=returns, mode=CSV_MODE, seed=0, digest=array_digest(returns)
        )
    except MarketError:
        log.exception("Loading return history failed.", path=str(path))
        raise
    except OSError as err:
        log.exception("Loading return history failed.", path=str(path))
        raise MarketError(f"could not read {path}") from err
    else:
        log.info(
            "Loading return history succeeded.",
            path=str(path),
            scenarios=int(scenarios.returns.shape[0]),
            digest=scenarios.digest,
        )
        return scenarios
