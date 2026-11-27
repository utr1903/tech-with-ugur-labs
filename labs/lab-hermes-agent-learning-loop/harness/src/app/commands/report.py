"""The `report` command: results/metrics.md from the recorded runs."""

from __future__ import annotations

from pathlib import Path

from app.envvars import Settings
from app.errors import ReportError
from app.logging_setup import Logger
from app.metrics.aggregate import load_records, summarise
from app.metrics.markdown import render
from app.output import write_line


def run(settings: Settings, *, log: Logger) -> Path:
    """Aggregates every run record and writes `metrics.md`."""
    results = settings.results_dir
    records = load_records(results)
    if not records:
        raise ReportError(f"No run records found under {results}")
    target = results / "metrics.md"
    target.write_text(render(summarise(records), records, results), encoding="utf-8")
    log.info("Wrote the metrics report.", path=str(target), records=len(records))
    write_line(f"Wrote {target} from {len(records)} runs")
    return target
