"""Wire the experiment to its logger and process exit status."""

from __future__ import annotations

import sys
from pathlib import Path

from app.commands.run import run
from app.errors import LabError
from app.logging_setup import configure_logging, install_global_error_handlers


def main() -> int:
    """Run the fixed experiment and report its lowest final cost."""
    log = configure_logging(app_name="gradient-descent-1d")
    install_global_error_handlers(log)
    try:
        rows = run(output_dir=Path("output"), log=log)
    except LabError:
        log.exception("Experiment command failed.")
        return 1
    best = min((row for row in rows if row.iteration == 100), key=lambda row: row.cost)
    log.info(
        "Comparing final costs succeeded.",
        run=best.run,
        x=best.x,
        lowest_final_cost=best.cost,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
