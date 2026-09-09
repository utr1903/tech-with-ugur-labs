"""Loading and validating the committed data snapshot."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from app import config


class SnapshotError(RuntimeError):
    """Raised when the snapshot is not the dataset the backtest expects."""


def load_snapshot(path: Path = config.SNAPSHOT_PATH) -> pd.DataFrame:
    """Reads the committed CSV into a time-indexed frame."""
    if not path.exists():
        raise SnapshotError(
            f"no snapshot at {path} - run `python main.py fetch` to build it"
        )
    frame = pd.read_csv(path, index_col="time", parse_dates=["time"])
    return frame[list(config.ALL_VARIABLES)]


def validate_snapshot(frame: pd.DataFrame) -> None:
    """Enforces the snapshot integrity check the lab depends on."""
    if list(frame.columns) != list(config.ALL_VARIABLES):
        raise SnapshotError(f"unexpected columns: {list(frame.columns)}")

    if len(frame) != config.EXPECTED_ROWS:
        raise SnapshotError(
            f"expected {config.EXPECTED_ROWS} rows, found {len(frame)}"
        )

    nulls = frame.isnull().sum()
    if nulls.any():
        raise SnapshotError(f"null values present: {nulls[nulls > 0].to_dict()}")

    gaps = frame.index.to_series().diff().dropna().unique()
    if len(gaps) != 1 or gaps[0] != pd.Timedelta(hours=1):
        raise SnapshotError("the hour grid is not contiguous and hourly")
