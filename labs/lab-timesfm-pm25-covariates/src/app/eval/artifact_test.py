from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app import config
from app.errors import ArtifactError
from app.eval import artifact
from app.eval.results import ExperimentResult, Scores
from app.logging_setup import Logger


def test_backtest_artifact_roundtrips(tmp_path: Path, log: Logger) -> None:
    path = tmp_path / "forecasts.npz"

    shape = (config.EXPECTED_ORIGINS, config.HORIZON_HOURS)
    quantile_shape = (*shape, config.N_QUANTILES)
    # Distinct values in every array, not a single repeated constant, so a
    # rewrite that mixes up positions or drops an array still fails the
    # roundtrip instead of accidentally matching by coincidence.
    results = {
        "seasonal-naive": ExperimentResult(
            points=np.arange(np.prod(shape), dtype=np.float32).reshape(shape),
            quantiles=np.arange(np.prod(quantile_shape), dtype=np.float32).reshape(
                quantile_shape
            ),
            scores=Scores(mae=17.83, rmse=23.5, mase=1.0, coverage=float("nan")),
        )
    }
    repeat = (
        np.arange(
            config.DETERMINISM_ORIGINS * config.HORIZON_HOURS, dtype=np.float32
        ).reshape(config.DETERMINISM_ORIGINS, config.HORIZON_HOURS)
        + 1000.0
    )

    artifact.save_artifact(path, results, repeat, log=log)

    # The archive's key layout is part of the contract: assert the exact key
    # set so a rewrite that drops or renames one silently is caught here,
    # not by a coincidental shape match in the roundtrip below.
    assert set(np.load(path).files) == {
        "seasonal-naive::points",
        "seasonal-naive::quantiles",
        "__scores__",
        "__determinism_repeat__",
    }

    loaded_results, loaded_repeat = artifact.load_artifact(path, log=log)

    assert set(loaded_results) == set(results)
    np.testing.assert_array_equal(
        loaded_results["seasonal-naive"].points, results["seasonal-naive"].points
    )
    np.testing.assert_array_equal(
        loaded_results["seasonal-naive"].quantiles,
        results["seasonal-naive"].quantiles,
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
