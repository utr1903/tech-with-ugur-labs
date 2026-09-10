from __future__ import annotations

import numpy as np
import pytest

from app import config
from app.data import snapshot
from app.forecast import model, scaling, windows
from app.logging_setup import Logger

pytestmark = pytest.mark.slow


def test_univariate_forecast_has_the_documented_shapes(log: Logger) -> None:
    frame = snapshot.load_snapshot(log=log)
    window = windows.build_windows(frame)[0]
    forecaster = model.build_forecaster(log=log)

    outputs = list(
        forecaster.predict_batch(
            contexts=[windows.target_context(frame, window)],
            horizon=config.HORIZON_HOURS,
            return_quantiles=True,
            use_symmetric_averaging=False,
            make_positive=True,
        )
    )

    assert len(outputs) == 1
    assert outputs[0].forecast.shape == (config.HORIZON_HOURS,)
    assert outputs[0].quantiles.shape == (
        config.HORIZON_HOURS,
        config.N_QUANTILES,
    )
    assert np.isfinite(outputs[0].forecast).all()


def test_past_future_covariates_need_edge_padding(log: Logger) -> None:
    """horizon 24 rounds up to the model's output patch length of 64.

    Past-and-future covariates are expected to span context + 64. We supply
    context + 24 - the 24 hours we claim to know - and let padding_mode="edge"
    extend them.
    """
    frame = snapshot.load_snapshot(log=log)
    window = windows.build_windows(frame)[0]
    forecaster = model.build_forecaster(log=log)

    columns = list(config.WEATHER_VARIABLES)
    block = np.concatenate(
        [
            windows.context_block(frame, window, columns),
            windows.horizon_block(frame, window, columns),
        ],
        axis=1,
    )
    assert block.shape == (
        len(columns),
        config.CONTEXT_HOURS + config.HORIZON_HOURS,
    )
    scaled = scaling.standardize_channels(block, config.CONTEXT_HOURS)

    outputs = list(
        forecaster.predict_batch(
            contexts=[windows.target_context(frame, window)],
            horizon=config.HORIZON_HOURS,
            past_future_covariates=[scaled],
            return_quantiles=True,
            use_symmetric_averaging=False,
            make_positive=True,
            padding_mode="edge",
        )
    )

    assert outputs[0].quantiles.shape == (
        config.HORIZON_HOURS,
        config.N_QUANTILES,
    )
    assert np.isfinite(outputs[0].forecast).all()
