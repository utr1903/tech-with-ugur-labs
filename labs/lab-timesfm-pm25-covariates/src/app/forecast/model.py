"""Running TimesFM 3.0 over the backtest windows."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd
from timesfm3 import ModelConfig, TimesFM3Forecaster

from app import config
from app.eval import experiments
from app.forecast import scaling, windows


def build_forecaster(batch_size: int = config.BATCH_SIZE) -> TimesFM3Forecaster:
    """Loads the 3.0 checkpoint.

    `device` is left unset, which resolves to CUDA when it is available and CPU
    otherwise - the container has no GPU, so this is the CPU path. The
    checkpoint is ~1.32 GB and is cached in a named Docker volume, so it
    downloads once.
    """
    return TimesFM3Forecaster(
        ModelConfig(
            checkpoint_path=config.CHECKPOINT,
            per_core_batch_size=batch_size,
        )
    )


def covariate_blocks(
    frame: pd.DataFrame,
    window: windows.Window,
    experiment: experiments.Experiment,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Builds the standardised covariate arrays for one origin.

    Past-only stops at the origin. Past-and-future runs one horizon beyond it -
    for the weather that is a legitimate forecast, and for the leaky control it
    is the cheat.
    """
    past_only = None
    if experiment.past_only:
        block = windows.context_block(frame, window, experiment.past_only)
        past_only = scaling.standardize_channels(block, config.CONTEXT_HOURS)

    past_future = None
    if experiment.past_future:
        block = np.concatenate(
            [
                windows.context_block(frame, window, experiment.past_future),
                windows.horizon_block(frame, window, experiment.past_future),
            ],
            axis=1,
        )
        past_future = scaling.standardize_channels(block, config.CONTEXT_HOURS)

    return past_only, past_future


def run_experiment(
    model: TimesFM3Forecaster,
    frame: pd.DataFrame,
    built: Sequence[windows.Window],
    experiment: experiments.Experiment,
) -> tuple[np.ndarray, np.ndarray]:
    """Forecasts every origin for one configuration.

    All origins go into a single predict_batch call, which chunks them
    internally by per_core_batch_size. Looping one origin at a time would pay
    the per-call overhead 90 times over.
    """
    contexts = []
    past_only_list: list[np.ndarray | None] = []
    past_future_list: list[np.ndarray | None] = []

    for window in built:
        contexts.append(windows.target_context(frame, window))
        past_only, past_future = covariate_blocks(frame, window, experiment)
        past_only_list.append(past_only)
        past_future_list.append(past_future)

    outputs = list(
        model.predict_batch(
            contexts=contexts,
            horizon=config.HORIZON_HOURS,
            past_only_covariates=(
                past_only_list if experiment.past_only else None
            ),
            past_future_covariates=(
                past_future_list if experiment.past_future else None
            ),
            return_quantiles=True,
            use_symmetric_averaging=False,
            make_positive=True,
            sort_quantiles=True,
            # horizon 24 rounds up to the model's 64-step output patch;
            # edge-pad the covariates over the difference rather than
            # pretending to know 64 hours of weather.
            padding_mode="edge",
        )
    )

    points = np.stack([out.forecast for out in outputs]).astype(np.float32)
    quantiles = np.stack([out.quantiles for out in outputs]).astype(np.float32)
    return points, quantiles
