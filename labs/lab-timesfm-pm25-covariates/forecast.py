"""Running TimesFM 3.0 over the backtest windows."""

from __future__ import annotations

import numpy as np
import pandas as pd
from timesfm3 import ModelConfig, TimesFM3Forecaster

import labconfig


def build_forecaster(batch_size: int = labconfig.BATCH_SIZE) -> TimesFM3Forecaster:
    """Loads the 3.0 checkpoint.

    `device` is left unset, which resolves to CUDA when it is available and CPU
    otherwise - the container has no GPU, so this is the CPU path. The
    checkpoint is ~1.32 GB and is cached in a named Docker volume, so it
    downloads once.
    """
    return TimesFM3Forecaster(
        ModelConfig(
            checkpoint_path=labconfig.CHECKPOINT,
            per_core_batch_size=batch_size,
        )
    )
