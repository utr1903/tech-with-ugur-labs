import numpy as np
import pytest

import labconfig
import main


def test_backtest_artifact_roundtrips(tmp_path, monkeypatch):
    path = tmp_path / "forecasts.npz"
    monkeypatch.setattr(labconfig, "FORECASTS_PATH", path)

    shape = (labconfig.EXPECTED_ORIGINS, labconfig.HORIZON_HOURS)
    results = {
        "seasonal-naive": {
            "points": np.full(shape, 1.0, dtype=np.float32),
            "quantiles": np.full((*shape, labconfig.N_QUANTILES), 1.0, np.float32),
            "scores": {"mae": 17.83, "rmse": 23.5, "mase": 1.0, "coverage": float("nan")},
        }
    }
    repeat = np.full((labconfig.DETERMINISM_ORIGINS, labconfig.HORIZON_HOURS), 1.0)

    main.save_artifact(path, results, repeat)
    loaded_results, loaded_repeat = main.load_artifact(path)

    assert set(loaded_results) == set(results)
    np.testing.assert_array_equal(
        loaded_results["seasonal-naive"]["points"], results["seasonal-naive"]["points"]
    )
    assert loaded_results["seasonal-naive"]["scores"]["mae"] == 17.83
    np.testing.assert_array_equal(loaded_repeat, repeat)


def test_unknown_command_is_rejected():
    with pytest.raises(SystemExit) as exit_info:
        main.main(["nonsense"])
    assert exit_info.value.code != 0
