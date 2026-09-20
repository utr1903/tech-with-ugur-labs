"""Behaviour tests for the seeded market generator and the CSV loader.

The two distribution-shape tests draw 200,000 scenarios each, which is
deliberate: the whole claim of the lab is that one mode has heavy, skewed
loss tails and the other does not, and a sample small enough to be cheap is
too small to tell them apart. They are module-scoped so the draws happen
once. Every other test here runs on a few hundred scenarios.

`scipy` is a development dependency only. It is used here, never in `app`.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
import scipy.stats as stats

from app.contracts import FloatArray, GeneratorSettings, MarketScenarios, Universe
from app.errors import MarketError
from app.logging_setup import Logger
from app.market import (
    generate_scenarios,
    jump_columns,
    load_returns_csv,
    market_factor_moments,
    matched_gaussian_moments,
    style_loadings,
)
from app.tailrisk import portfolio_losses

LARGE_SAMPLE = 200_000
SMALL_SAMPLE = 512


def _equal_weight(universe: Universe) -> FloatArray:
    """Return the equal-weighted long-only book over the whole universe."""
    return np.full(len(universe.names), 1.0 / len(universe.names))


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
    universe: Universe,
    generator_settings: GeneratorSettings,
    large_fat_tailed: MarketScenarios,
    large_gaussian: MarketScenarios,
) -> None:
    # Per-name means agree to 1e-3 and standard deviations to 5%. The mean
    # tolerance cannot be much tighter than this: a name whose monthly
    # standard deviation is 0.077 has a standard error of 1.7e-4 on its
    # sample mean at 200,000 draws, so two independent samples routinely sit
    # several of those apart. What is exact is the closed form, which both
    # samples are checked against below.
    closed_mean, closed_sigma = matched_gaussian_moments(generator_settings, universe)

    for scenarios in (large_fat_tailed, large_gaussian):
        drawn = scenarios.returns
        assert np.abs(drawn.mean(axis=0) - closed_mean).max() < 1e-3
        assert np.abs(drawn.std(axis=0) / closed_sigma - 1.0).max() < 0.05

    fat_returns = large_fat_tailed.returns
    gaussian_returns = large_gaussian.returns
    assert np.abs(fat_returns.mean(axis=0) - gaussian_returns.mean(axis=0)).max() < 1e-3
    assert (
        np.abs(fat_returns.std(axis=0) / gaussian_returns.std(axis=0) - 1.0).max()
        < 0.05
    )


def test_matched_moments_follow_the_closed_form_and_not_the_sample(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    market_mean, market_sigma = market_factor_moments(generator_settings)
    settings = generator_settings
    probability = settings.stress_probability

    expected_mean = probability * settings.stress_mean
    expected_variance = (
        (1.0 - probability) * settings.calm_sigma**2
        + probability * (settings.stress_sigma**2 + settings.stress_mean**2)
        - expected_mean**2
    )
    assert market_mean == pytest.approx(expected_mean)
    assert market_sigma == pytest.approx(np.sqrt(expected_variance))

    closed_mean, closed_sigma = matched_gaussian_moments(settings, universe)
    jump_mean = settings.jump_probability * settings.jump_mean
    jump_variance = (
        settings.jump_probability * (settings.jump_sigma**2 + settings.jump_mean**2)
        - jump_mean**2
    )
    carriers = jump_columns(universe, settings)
    quiet = np.setdiff1d(np.arange(len(universe.names)), carriers)

    assert closed_mean[quiet] == pytest.approx(universe.expected_return[quiet])
    assert closed_mean[carriers] == pytest.approx(
        universe.expected_return[carriers] + jump_mean
    )
    assert (closed_sigma[carriers] ** 2 - closed_sigma[quiet].mean() ** 2).min() > 0.0
    assert jump_variance > 0.0
    assert not closed_mean.flags.writeable


def test_style_loadings_tie_every_name_to_its_own_sector_and_the_next(
    universe: Universe, generator_settings: GeneratorSettings
) -> None:
    loadings = style_loadings(universe, generator_settings.factor_count)

    assert loadings.shape == (len(universe.names), generator_settings.factor_count)
    assert np.all(loadings.sum(axis=1) == pytest.approx(0.8))
    for index, sector in enumerate(universe.sector_of):
        own = int(sector) % generator_settings.factor_count
        assert loadings[index, own] == pytest.approx(0.6)


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


def _write_csv(path: Path, header: tuple[str, ...], rows: list[list[float]]) -> Path:
    """Write a minimal return-history CSV and return its path."""
    lines = [",".join(header)]
    lines.extend(",".join(f"{value:.6f}" for value in row) for row in rows)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_returns_csv_loader_reads_a_matching_history(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    rows = [[0.01 * (index + 1)] * len(universe.names) for index in range(3)]
    path = _write_csv(tmp_path / "returns.csv", universe.names, rows)

    loaded = load_returns_csv(path, universe, log=log)

    assert loaded.mode == "returns_csv"
    assert loaded.returns.shape == (3, len(universe.names))
    assert loaded.returns[2, 0] == pytest.approx(0.03)
    assert not loaded.returns.flags.writeable


def test_returns_csv_loader_rejects_a_column_mismatch(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    short_header = universe.names[:-1]
    path = _write_csv(
        tmp_path / "returns.csv", short_header, [[0.0] * len(short_header)]
    )

    with pytest.raises(MarketError, match="column"):
        load_returns_csv(path, universe, log=log)


def test_returns_csv_loader_rejects_reordered_columns(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    swapped = (universe.names[1], universe.names[0], *universe.names[2:])
    path = _write_csv(tmp_path / "returns.csv", swapped, [[0.0] * len(swapped)])

    with pytest.raises(MarketError, match="column"):
        load_returns_csv(path, universe, log=log)


def test_returns_csv_loader_names_the_row_and_column_of_a_bad_cell(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    path = tmp_path / "returns.csv"
    body = ["0.0"] * len(universe.names)
    body[4] = "not-a-number"
    path.write_text(
        ",".join(universe.names) + "\n" + ",".join(body) + "\n", encoding="utf-8"
    )

    with pytest.raises(MarketError, match=f"row 2, column '{universe.names[4]}'"):
        load_returns_csv(path, universe, log=log)


def test_returns_csv_loader_rejects_a_header_with_no_rows(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    path = _write_csv(tmp_path / "returns.csv", universe.names, [])

    with pytest.raises(MarketError, match="no return rows"):
        load_returns_csv(path, universe, log=log)


def test_returns_csv_loader_reports_a_missing_file(
    tmp_path: Path, universe: Universe, log: Logger
) -> None:
    with pytest.raises(MarketError, match="could not read"):
        load_returns_csv(tmp_path / "absent.csv", universe, log=log)
