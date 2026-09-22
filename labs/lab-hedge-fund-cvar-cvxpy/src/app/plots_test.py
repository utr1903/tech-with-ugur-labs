"""Tests for the three figures.

One of these is about the import graph rather than about a picture. The
plotting modules must never reach for `pyplot`, because importing it picks
a backend for the whole process and starts a registry of open figures —
the two things that make a plotting test on a laptop open a window and
then leak. The object-oriented `Figure` API has neither, and the test
below is what keeps it that way.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

from app import plots, plots_book, plots_figures, plots_theme
from app.bundle import RunBundle
from app.errors import ArtifactError
from app.logging_setup import Logger
from app.plots import (
    EXPOSURE_PLOT,
    FRONTIER_PLOT,
    LOSS_PLOT,
    save_figure,
    write_plots,
)
from app.plots_book import build_exposures, build_loss_distribution
from app.plots_figures import build_frontier

PLOT_MODULES = (plots, plots_book, plots_figures, plots_theme)

# A PNG smaller than this is an empty canvas rather than a chart.
MINIMUM_BYTES = 1024


def test_plots_are_written_and_are_non_empty(
    tmp_path: Path, bundle: RunBundle, log: Logger
) -> None:
    """All three figures land in the directory with real content in them."""
    write_plots(tmp_path, bundle, log=log)
    for name in (FRONTIER_PLOT, LOSS_PLOT, EXPOSURE_PLOT):
        assert (tmp_path / name).stat().st_size > MINIMUM_BYTES


def test_the_plotting_modules_never_import_pyplot() -> None:
    """The letter of the rule: no import of `pyplot` in the plotting layer."""
    for module in PLOT_MODULES:
        source = Path(module.__file__ or "").read_text(encoding="utf-8")
        assert "import matplotlib.pyplot" not in source
        assert "from matplotlib import pyplot" not in source


def test_drawing_a_figure_leaves_no_pyplot_state_behind(
    bundle: RunBundle,
) -> None:
    """The spirit of it: building a figure must not pull pyplot in either."""
    figure = build_frontier(bundle)
    try:
        assert "matplotlib.pyplot" not in sys.modules
    finally:
        figure.clear()


def test_a_saved_figure_is_released(tmp_path: Path, bundle: RunBundle) -> None:
    """Every figure is cleared once it is on disk, successful or not."""
    figure = build_exposures(bundle)
    save_figure(figure, tmp_path / "exposures.png")
    assert figure.axes == []


def test_an_infeasible_headline_still_draws_the_frontier(
    tmp_path: Path, infeasible_bundle: RunBundle, log: Logger
) -> None:
    """The sweep is a property of the mandate; the other two need a book."""
    write_plots(tmp_path, infeasible_bundle, log=log)
    assert sorted(path.name for path in tmp_path.iterdir()) == [FRONTIER_PLOT]


def test_a_book_is_refused_rather_than_drawn_empty(bundle: RunBundle) -> None:
    """Asking for a portfolio figure without a portfolio is an error."""
    bookless = replace(
        bundle,
        headline=replace(bundle.headline, solution=None, status="infeasible"),
        verification=None,
    )
    with pytest.raises(ArtifactError, match="no book"):
        build_loss_distribution(bookless)
    with pytest.raises(ArtifactError, match="no book"):
        build_exposures(bookless)


def test_a_sweep_with_no_feasible_point_is_refused(bundle: RunBundle) -> None:
    """A frontier of nothing is an error rather than a blank chart."""
    empty = replace(bundle, frontier=())
    with pytest.raises(ArtifactError, match="no frontier"):
        build_frontier(empty)


def test_the_frontier_is_drawn_on_one_axis(bundle: RunBundle) -> None:
    """Two books, one ruler: both curves are a CVaR on the same tail.

    A second vertical scale would let the variance book's own objective
    and the CVaR book's tail loss appear to cross, which would be a
    picture of nothing.
    """
    figure = build_frontier(bundle)
    try:
        assert len(figure.axes) == 1
    finally:
        figure.clear()
