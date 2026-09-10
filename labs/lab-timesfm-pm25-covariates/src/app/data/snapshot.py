"""Loading and validating the committed data snapshot."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from app import config
from app.errors import SnapshotError
from app.logging_setup import Logger


def load_snapshot(path: Path = config.SNAPSHOT_PATH, *, log: Logger) -> pd.DataFrame:
    """Reads the committed CSV into a time-indexed frame."""
    if not path.exists():
        raise SnapshotError(
            f"no snapshot at {path} - run `uv run app fetch` to build it"
        )

    try:
        log.info("Loading the snapshot...", path=str(path))
        frame = pd.read_csv(path, index_col="time", parse_dates=["time"])
        frame = frame[list(config.ALL_VARIABLES)]
    except Exception as err:
        log.exception("Loading the snapshot failed.", path=str(path))
        raise SnapshotError(f"could not read snapshot at {path}") from err
    else:
        log.info("Loading the snapshot succeeded.", rows=len(frame))
        return frame


def validate_snapshot(frame: pd.DataFrame, *, log: Logger) -> None:
    """Enforces the snapshot integrity check the lab depends on."""
    log.info("Validating the snapshot...", rows=len(frame))

    if list(frame.columns) != list(config.ALL_VARIABLES):
        raise SnapshotError(f"unexpected columns: {list(frame.columns)}")

    if len(frame) != config.EXPECTED_ROWS:
        raise SnapshotError(f"expected {config.EXPECTED_ROWS} rows, found {len(frame)}")

    nulls = frame.isnull().sum()
    if nulls.any():
        raise SnapshotError(f"null values present: {nulls[nulls > 0].to_dict()}")

    gaps = frame.index.to_series().diff().dropna().unique()
    if len(gaps) != 1 or gaps[0] != pd.Timedelta(hours=1):
        raise SnapshotError("the hour grid is not contiguous and hourly")

    log.info("Validating the snapshot succeeded.", rows=len(frame))
