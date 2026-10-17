"""Saving the three figures into `output/`, and releasing every one of them.

**The backend is pinned twice.** `MPLBACKEND=Agg` is set in the image, and
`matplotlib.use("Agg")` is called again here before anything is drawn, so a
reader who runs `pytest` on their own laptop without the container gets the
same headless rendering instead of a window. The second belt is cheap and
the failure it prevents is confusing.

**No figure is left open.** `plots_figures.py` builds through the
object-oriented `Figure` API rather than `pyplot`, so there is no global
registry to leak into: a figure lives exactly as long as the reference
this module holds. Each one is cleared as soon as it is saved, whether or
not the save succeeded, so a failure on the second figure cannot strand
the first.

**A run with no book still plots what it has.** The frontier is a property
of the mandate and the sample, so it is drawn whenever any swept target
produced a book. The loss distribution and the exposure map describe the
headline portfolio, so an infeasible headline skips them and the skip is
logged rather than raised — an unreachable return target is a result this
lab reports, not a failure.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import matplotlib
from matplotlib.figure import Figure

from app.bundle import RunBundle
from app.errors import ArtifactError
from app.logging_setup import Logger
from app.plots_book import build_exposures, build_loss_distribution
from app.plots_figures import build_frontier

# The non-interactive backend every figure is rendered through.
BACKEND = "Agg"

FRONTIER_PLOT = "frontier.png"
LOSS_PLOT = "loss_distribution.png"
EXPOSURE_PLOT = "exposures.png"

Builder = Callable[[RunBundle], Figure]


def _figures(bundle: RunBundle) -> list[tuple[str, Builder]]:
    """Return the figures this run can actually draw, in file-name order."""
    drawable: list[tuple[str, Builder]] = [(FRONTIER_PLOT, build_frontier)]
    if bundle.headline.solution is not None and bundle.verification is not None:
        drawable.append((LOSS_PLOT, build_loss_distribution))
        drawable.append((EXPOSURE_PLOT, build_exposures))
    return drawable


def save_figure(figure: Figure, path: Path) -> None:
    """Write one figure to `path` and release it either way."""
    try:
        figure.savefig(path, format="png", facecolor=figure.get_facecolor())
    finally:
        figure.clear()


def write_plots(output_dir: Path, bundle: RunBundle, *, log: Logger) -> None:
    """Draw and save every figure this run can produce.

    Args:
        output_dir: The directory to write into. Created if it is missing.
        bundle: One complete run.
        log: Logger for the operation boundary.

    Raises:
        ArtifactError: If no swept target produced a book, so not even the
            frontier can be drawn, or if a figure cannot be written.
    """
    matplotlib.use(BACKEND)
    drawable = _figures(bundle)
    plot_log = log.bind(output_dir=str(output_dir), figures=len(drawable))
    try:
        plot_log.info("Writing the figures...", names=[name for name, _ in drawable])
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, build in drawable:
            save_figure(build(bundle), output_dir / name)
    except OSError as err:
        plot_log.exception("Writing the figures failed.")
        raise ArtifactError(f"could not write the figures to {output_dir}") from err
    except Exception:
        plot_log.exception("Writing the figures failed.")
        raise
    else:
        if len(drawable) == 1:
            plot_log.warning(
                "Skipped the figures that describe a portfolio.",
                status=bundle.headline.status,
                skipped=[LOSS_PLOT, EXPOSURE_PLOT],
            )
        plot_log.info(
            "Writing the figures succeeded.",
            bytes=[(output_dir / name).stat().st_size for name, _ in drawable],
        )
