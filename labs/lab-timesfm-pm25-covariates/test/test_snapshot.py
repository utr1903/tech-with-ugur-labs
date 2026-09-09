import pandas as pd
import pytest

import labconfig
import snapshot


def _good_frame(n=labconfig.EXPECTED_ROWS):
    index = pd.date_range(labconfig.FETCH_START, periods=n, freq="h", name="time")
    return pd.DataFrame(
        {name: [1.0] * n for name in labconfig.ALL_VARIABLES}, index=index
    )


def test_validate_accepts_a_well_formed_snapshot():
    snapshot.validate_snapshot(_good_frame())


def test_validate_rejects_wrong_row_count():
    with pytest.raises(snapshot.SnapshotError, match="9504"):
        snapshot.validate_snapshot(_good_frame(n=9503))


def test_validate_rejects_nulls():
    frame = _good_frame()
    frame.iloc[5, 0] = None
    with pytest.raises(snapshot.SnapshotError, match="null"):
        snapshot.validate_snapshot(frame)


def test_validate_rejects_a_gappy_hour_grid():
    frame = _good_frame()
    frame = frame.drop(frame.index[10])
    with pytest.raises(snapshot.SnapshotError):
        snapshot.validate_snapshot(frame)


def test_committed_snapshot_loads_and_validates():
    frame = snapshot.load_snapshot()
    snapshot.validate_snapshot(frame)
    assert len(frame) == labconfig.EXPECTED_ROWS
