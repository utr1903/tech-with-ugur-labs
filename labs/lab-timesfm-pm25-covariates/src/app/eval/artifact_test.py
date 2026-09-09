from __future__ import annotations

import numpy as np

from app import config
from app.eval import artifact


def test_backtest_artifact_roundtrips(tmp_path, monkeypatch):
    path = tmp_path / "forecasts.npz"
    monkeypatch.setattr(config, "FORECASTS_PATH", path)

    shape = (config.EXPECTED_ORIGINS, config.HORIZON_HOURS)
    results = {
        "seasonal-naive": {
            "points": np.full(shape, 1.0, dtype=np.float32),
            "quantiles": np.full((*shape, config.N_QUANTILES), 1.0, np.float32),
            "scores": {"mae": 17.83, "rmse": 23.5, "mase": 1.0, "coverage": float("nan")},
        }
    }
    repeat = np.full((config.DETERMINISM_ORIGINS, config.HORIZON_HOURS), 1.0)

    artifact.save_artifact(path, results, repeat)
    loaded_results, loaded_repeat = artifact.load_artifact(path)

    assert set(loaded_results) == set(results)
    np.testing.assert_array_equal(
        loaded_results["seasonal-naive"]["points"], results["seasonal-naive"]["points"]
    )
    assert loaded_results["seasonal-naive"]["scores"]["mae"] == 17.83
    np.testing.assert_array_equal(loaded_repeat, repeat)
