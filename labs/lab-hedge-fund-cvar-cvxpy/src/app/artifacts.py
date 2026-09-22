"""Writing the run to `output/`, in an order that cannot leave a half-run.

Two rules, and both are about what a reader finds in the directory after
something goes wrong.

**Serialize everything, then write.** Every file's full text is built in
memory before a single byte reaches the disk. Most of what can fail here
fails during serialization — a dual carrying a label the lab cannot say
what it is written on, a value JSON will not encode — and doing that work
first means such a failure leaves the previous run's `output/` exactly as
it was, rather than a fresh `weights.csv` beside a stale `solution.json`
describing a different book.

**Replace, never append.** Each file is written to a `.tmp` sibling and
then moved onto its final name with `Path.replace`, which is atomic on a
single filesystem. A reader tailing `output/` sees the old file or the new
one, never a truncated one.

The formats are split by audience. The four CSVs are for a spreadsheet and
`solution.json` is for a script; both carry raw floats, because the console
beside them is where rounding belongs.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.artifacts_payload import solution_payload
from app.artifacts_sweeps import algorithms_csv, duals_csv, frontier_csv
from app.artifacts_tables import sectors_csv, weights_csv
from app.bundle import RunBundle
from app.errors import ArtifactError
from app.logging_setup import Logger

# The suffix a file is built under before it is moved onto its own name.
TEMPORARY_SUFFIX = ".tmp"

# How `solution.json` is indented. Two spaces, so the file is readable in
# a diff when a reader changes the scenario and runs again.
JSON_INDENT = 2


def _documents(bundle: RunBundle) -> dict[str, str]:
    """Serialize every artifact to text, before anything is written.

    Returns:
        Filename to file contents, for every file a run produces.

    Raises:
        ArtifactError: If a dual row carries a label the lab cannot say
            which expression it is written on.
        TypeError: If the payload holds a value `json` cannot encode,
            which would be a contract change rather than bad input.
    """
    return {
        "weights.csv": weights_csv(bundle),
        "sectors.csv": sectors_csv(bundle),
        "frontier.csv": frontier_csv(bundle.frontier),
        "algorithms.csv": algorithms_csv(bundle.ladder),
        "duals.csv": duals_csv(bundle.duals),
        "solution.json": json.dumps(solution_payload(bundle), indent=JSON_INDENT)
        + "\n",
    }


def _replace(path: Path, text: str) -> None:
    """Write `text` to a temporary sibling and move it onto `path`."""
    temporary = path.with_name(path.name + TEMPORARY_SUFFIX)
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def write_artifacts(output_dir: Path, bundle: RunBundle, *, log: Logger) -> None:
    """Write every result file for one run into `output_dir`.

    Args:
        output_dir: The directory to write into. Created if it is missing.
        bundle: One complete run. A bundle whose headline carries no
            weights still produces all six files; `weights.csv` and
            `sectors.csv` then hold their header row alone and
            `solution.json` records a null weight vector.
        log: Logger for the operation boundary.

    Raises:
        ArtifactError: If the run cannot be serialized, or if the
            directory cannot be written to.
    """
    write_log = log.bind(output_dir=str(output_dir), status=bundle.headline.status)
    try:
        write_log.info("Writing the result files...")
        documents = _documents(bundle)
        output_dir.mkdir(parents=True, exist_ok=True)
        for name, text in documents.items():
            _replace(output_dir / name, text)
    except OSError as err:
        write_log.exception("Writing the result files failed.")
        raise ArtifactError(
            f"could not write the result files to {output_dir}"
        ) from err
    except Exception:
        write_log.exception("Writing the result files failed.")
        raise
    else:
        write_log.info(
            "Writing the result files succeeded.",
            files=sorted(documents),
            bytes=sum(len(text.encode("utf-8")) for text in documents.values()),
        )
