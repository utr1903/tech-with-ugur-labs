"""Rolling origins and the slices of data each one is allowed to see."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app import config
from app.errors import WindowError
from app.eval.results import FloatArray


@dataclass(frozen=True)
class Window:
    """One forecast origin and where its context begins in the frame."""

    origin: pd.Timestamp
    start: int


def origin_timestamps() -> list[pd.Timestamp]:
    """The daily 00:00 UTC origins across the winter window."""
    return list(pd.date_range(config.BACKTEST_START, config.BACKTEST_END, freq="D"))


def build_windows(frame: pd.DataFrame) -> list[Window]:
    """Turns origin timestamps into positional windows over `frame`."""
    positions = {stamp: i for i, stamp in enumerate(frame.index)}
    built: list[Window] = []
    for origin in origin_timestamps():
        if origin not in positions:
            raise WindowError(f"origin {origin} is not in the snapshot")
        start = positions[origin] - config.CONTEXT_HOURS
        end = positions[origin] + config.HORIZON_HOURS
        if start < 0 or end > len(frame):
            raise WindowError(f"origin {origin} does not have room for its window")
        built.append(Window(origin=origin, start=start))
    return built


def context_block(
    frame: pd.DataFrame, window: Window, columns: Sequence[str]
) -> FloatArray:
    """The context hours for `columns`, shaped (channels, CONTEXT_HOURS)."""
    stop = window.start + config.CONTEXT_HOURS
    block = frame[list(columns)].to_numpy()[window.start : stop]
    return np.ascontiguousarray(block.T, dtype=np.float32)


def horizon_block(
    frame: pd.DataFrame, window: Window, columns: Sequence[str]
) -> FloatArray:
    """The horizon hours for `columns`, shaped (channels, HORIZON_HOURS)."""
    start = window.start + config.CONTEXT_HOURS
    stop = start + config.HORIZON_HOURS
    block = frame[list(columns)].to_numpy()[start:stop]
    return np.ascontiguousarray(block.T, dtype=np.float32)


def target_context(frame: pd.DataFrame, window: Window) -> FloatArray:
    """The target's context as a 1-D array.

    TimesFM keys its output shape off the input rank: a 1-D context yields
    (horizon,) and (horizon, 9). Keeping this 1-D is what gives the lab its
    (24, 9) quantile blocks.
    """
    context: FloatArray = context_block(frame, window, [config.TARGET])[0]
    return context


def actuals(frame: pd.DataFrame, built: Sequence[Window]) -> FloatArray:
    """The measured truth for every origin, shaped (origins, HORIZON_HOURS)."""
    return np.stack(
        [horizon_block(frame, window, [config.TARGET])[0] for window in built]
    )
