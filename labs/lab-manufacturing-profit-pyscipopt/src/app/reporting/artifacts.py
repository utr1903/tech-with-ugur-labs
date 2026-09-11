"""Stage a complete verified report before atomically replacing each artifact."""

from __future__ import annotations

import csv
from pathlib import Path
from tempfile import TemporaryDirectory

from app.contracts import Scenario, SolveResult
from app.errors import ArtifactError, VerificationError
from app.logging_setup import Logger
from app.reporting.breakdowns import build_tables
from app.reporting.plots import write_plots
from app.reporting.serialization import RunSource, solution_json
from app.verification import VerificationReport


def write_artifacts(
    output_dir: Path,
    scenario: Scenario,
    result: SolveResult,
    verification: VerificationReport | None,
    *,
    log: Logger,
    source: RunSource | None = None,
) -> tuple[Path, ...]:
    if not result.metadata.has_incumbent or result.decisions is None:
        return ()
    if verification is None or not verification.ok:
        raise VerificationError("Artifacts require an independently verified incumbent")
    log.info("Writing artifacts...", directory=str(output_dir))
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix=".report-", dir=output_dir) as temporary:
            stage = Path(temporary)
            (stage / "solution.json").write_text(
                solution_json(scenario, result, verification, source), encoding="utf-8"
            )
            for table in build_tables(scenario, result.decisions, verification):
                with (stage / f"{table.name}.csv").open(
                    "w", newline="", encoding="utf-8"
                ) as stream:
                    writer = csv.writer(stream)
                    writer.writerow(table.columns)
                    writer.writerows(table.rows)
            write_plots(stage, scenario, result.decisions, verification, log=log)
            paths = tuple(output_dir / path.name for path in sorted(stage.iterdir()))
            for destination in paths:
                (stage / destination.name).replace(destination)
    except OSError as err:
        log.exception("Writing artifacts failed.", directory=str(output_dir))
        raise ArtifactError(f"Could not write artifacts to {output_dir}") from err
    except Exception:
        log.exception("Writing artifacts failed.", directory=str(output_dir))
        raise
    else:
        log.info(
            "Writing artifacts succeeded.", files=len(paths), directory=str(output_dir)
        )
        return paths
