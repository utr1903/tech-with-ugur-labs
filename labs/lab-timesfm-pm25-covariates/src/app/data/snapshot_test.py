from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from app import config
from app.data import snapshot
from app.errors import SnapshotError
from app.logging_setup import Logger


def _good_frame(n: int = config.EXPECTED_ROWS) -> pd.DataFrame:
    index = pd.date_range(config.FETCH_START, periods=n, freq="h", name="time")
    return pd.DataFrame({name: [1.0] * n for name in config.ALL_VARIABLES}, index=index)


def test_validate_accepts_a_well_formed_snapshot(log: Logger) -> None:
    snapshot.validate_snapshot(_good_frame(), log=log)


def test_validate_rejects_wrong_row_count(log: Logger) -> None:
    with pytest.raises(SnapshotError, match="9504"):
        snapshot.validate_snapshot(_good_frame(n=9503), log=log)


def test_validate_rejects_nulls(log: Logger) -> None:
    frame = _good_frame()
    frame.iloc[5, 0] = None
    with pytest.raises(SnapshotError, match="null"):
        snapshot.validate_snapshot(frame, log=log)


def test_validate_rejects_a_gappy_hour_grid(log: Logger) -> None:
    frame = _good_frame()
    frame = frame.drop(frame.index[10])
    with pytest.raises(SnapshotError):
        snapshot.validate_snapshot(frame, log=log)


def test_load_snapshot_rejects_a_malformed_csv(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "malformed.csv"
    path.write_text("not,a,valid,snapshot\n1,2,3,4\n")
    with pytest.raises(SnapshotError, match="could not read snapshot"):
        snapshot.load_snapshot(path, log=log)


def test_committed_snapshot_loads_and_validates(log: Logger) -> None:
    frame = snapshot.load_snapshot(log=log)
    snapshot.validate_snapshot(frame, log=log)
    assert len(frame) == config.EXPECTED_ROWS
