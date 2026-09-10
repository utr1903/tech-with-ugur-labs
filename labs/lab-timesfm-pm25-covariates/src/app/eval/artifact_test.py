from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app import config
from app.errors import ArtifactError
from app.eval import artifact
from app.eval.results import ExperimentResult, Scores
from app.logging_setup import Logger


def test_backtest_artifact_roundtrips(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: Logger
) -> None:
    path = tmp_path / "forecasts.npz"
    monkeypatch.setattr(config, "FORECASTS_PATH", path)

    shape = (config.EXPECTED_ORIGINS, config.HORIZON_HOURS)
    results = {
        "seasonal-naive": ExperimentResult(
            points=np.full(shape, 1.0, dtype=np.float32),
            quantiles=np.full((*shape, config.N_QUANTILES), 1.0, np.float32),
            scores=Scores(mae=17.83, rmse=23.5, mase=1.0, coverage=float("nan")),
        )
    }
    repeat = np.full(
        (config.DETERMINISM_ORIGINS, config.HORIZON_HOURS), 1.0, dtype=np.float32
    )

    artifact.save_artifact(path, results, repeat, log=log)
    loaded_results, loaded_repeat = artifact.load_artifact(path, log=log)

    assert set(loaded_results) == set(results)
    np.testing.assert_array_equal(
        loaded_results["seasonal-naive"].points, results["seasonal-naive"].points
    )
    assert loaded_results["seasonal-naive"].scores.mae == 17.83
    np.testing.assert_array_equal(loaded_repeat, repeat)


def test_load_artifact_translates_a_missing_file_to_an_artifact_error(
    tmp_path: Path, log: Logger
) -> None:
    """The ordinary mistake of running `report` before `backtest` must raise a
    LabError, not a raw FileNotFoundError that escapes __main__'s except."""
    path = tmp_path / "no-such-forecasts.npz"
    with pytest.raises(ArtifactError, match="run `uv run app backtest` first"):
        artifact.load_artifact(path, log=log)
