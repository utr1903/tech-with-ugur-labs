import numpy as np
import pytest

import labconfig
import forecast
import scaling
import snapshot
import windows

pytestmark = pytest.mark.slow


def test_univariate_forecast_has_the_documented_shapes():
    frame = snapshot.load_snapshot()
    window = windows.build_windows(frame)[0]
    model = forecast.build_forecaster()

    outputs = list(
        model.predict_batch(
            contexts=[windows.target_context(frame, window)],
            horizon=labconfig.HORIZON_HOURS,
            return_quantiles=True,
            use_symmetric_averaging=False,
            make_positive=True,
        )
    )

    assert len(outputs) == 1
    assert outputs[0].forecast.shape == (labconfig.HORIZON_HOURS,)
    assert outputs[0].quantiles.shape == (
        labconfig.HORIZON_HOURS,
        labconfig.N_QUANTILES,
    )
    assert np.isfinite(outputs[0].forecast).all()


def test_past_future_covariates_need_edge_padding():
    """horizon 24 rounds up to the model's output patch length of 64.

    Past-and-future covariates are expected to span context + 64. We supply
    context + 24 - the 24 hours we claim to know - and let padding_mode="edge"
    extend them.
    """
    frame = snapshot.load_snapshot()
    window = windows.build_windows(frame)[0]
    model = forecast.build_forecaster()

    columns = list(labconfig.WEATHER_VARIABLES)
    block = np.concatenate(
        [
            windows.context_block(frame, window, columns),
            windows.horizon_block(frame, window, columns),
        ],
        axis=1,
    )
    assert block.shape == (
        len(columns),
        labconfig.CONTEXT_HOURS + labconfig.HORIZON_HOURS,
    )
    scaled = scaling.standardize_channels(block, labconfig.CONTEXT_HOURS)

    outputs = list(
        model.predict_batch(
            contexts=[windows.target_context(frame, window)],
            horizon=labconfig.HORIZON_HOURS,
            past_future_covariates=[scaled],
            return_quantiles=True,
            use_symmetric_averaging=False,
            make_positive=True,
            padding_mode="edge",
        )
    )

    assert outputs[0].quantiles.shape == (
        labconfig.HORIZON_HOURS,
        labconfig.N_QUANTILES,
    )
    assert np.isfinite(outputs[0].forecast).all()
