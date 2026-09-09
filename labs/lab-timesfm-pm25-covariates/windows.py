"""Rolling origins and the slices of data each one is allowed to see."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd

import labconfig


@dataclass(frozen=True)
class Window:
    """One forecast origin and where its context begins in the frame."""

    origin: pd.Timestamp
    start: int


def origin_timestamps() -> list[pd.Timestamp]:
    """The daily 00:00 UTC origins across the winter window."""
    return list(
        pd.date_range(
            labconfig.BACKTEST_START, labconfig.BACKTEST_END, freq="D"
        )
    )


def build_windows(frame: pd.DataFrame) -> list[Window]:
    """Turns origin timestamps into positional windows over `frame`."""
    positions = {stamp: i for i, stamp in enumerate(frame.index)}
    built: list[Window] = []
    for origin in origin_timestamps():
        if origin not in positions:
            raise ValueError(f"origin {origin} is not in the snapshot")
        start = positions[origin] - labconfig.CONTEXT_HOURS
        end = positions[origin] + labconfig.HORIZON_HOURS
        if start < 0 or end > len(frame):
            raise ValueError(f"origin {origin} does not have room for its window")
        built.append(Window(origin=origin, start=start))
    return built


def context_block(
    frame: pd.DataFrame, window: Window, columns: Sequence[str]
) -> np.ndarray:
    """The context hours for `columns`, shaped (channels, CONTEXT_HOURS)."""
    stop = window.start + labconfig.CONTEXT_HOURS
    block = frame[list(columns)].to_numpy()[window.start : stop]
    return np.ascontiguousarray(block.T, dtype=np.float32)


def horizon_block(
    frame: pd.DataFrame, window: Window, columns: Sequence[str]
) -> np.ndarray:
    """The horizon hours for `columns`, shaped (channels, HORIZON_HOURS)."""
    start = window.start + labconfig.CONTEXT_HOURS
    stop = start + labconfig.HORIZON_HOURS
    block = frame[list(columns)].to_numpy()[start:stop]
    return np.ascontiguousarray(block.T, dtype=np.float32)


def target_context(frame: pd.DataFrame, window: Window) -> np.ndarray:
    """The target's context as a 1-D array.

    TimesFM keys its output shape off the input rank: a 1-D context yields
    (horizon,) and (horizon, 9). Keeping this 1-D is what gives the lab its
    (24, 9) quantile blocks.
    """
    return context_block(frame, window, [labconfig.TARGET])[0]


def actuals(frame: pd.DataFrame, built: Sequence[Window]) -> np.ndarray:
    """The measured truth for every origin, shaped (origins, HORIZON_HOURS)."""
    return np.stack(
        [horizon_block(frame, window, [labconfig.TARGET])[0] for window in built]
    )
