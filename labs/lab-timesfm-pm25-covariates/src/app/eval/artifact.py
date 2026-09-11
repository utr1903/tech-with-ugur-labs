"""Persisting and reloading a backtest's forecasts, quantiles and scores."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from app.errors import ArtifactError
from app.eval.results import ExperimentResult, Scores
from app.lib.arrays import FloatArray
from app.logging_setup import Logger


def save_artifact(
    path: Path,
    results: dict[str, ExperimentResult],
    repeat: FloatArray,
    *,
    log: Logger,
) -> None:
    """Persists forecasts, quantiles and scores to one npz file.

    The flat `<name>::points` / `<name>::quantiles` keys, plus JSON packed
    into a 0-d `__scores__` array, are a deliberate compatibility boundary
    for this one file format - not a layout to copy elsewhere. It is the
    only place in this lab where structured data crosses a boundary as
    string-keyed data rather than as the dataclasses in `eval/results.py`.
    """
    try:
        log.info("Saving the forecasts...", path=str(path))
        path.parent.mkdir(parents=True, exist_ok=True)
        arrays: dict[str, npt.NDArray[Any]] = {"__determinism_repeat__": repeat}
        scores: dict[str, dict[str, float]] = {}
        for name, result in results.items():
            arrays[f"{name}::points"] = result.points
            arrays[f"{name}::quantiles"] = result.quantiles
            scores[name] = dataclasses.asdict(result.scores)
        arrays["__scores__"] = np.array(json.dumps(scores))
        np.savez_compressed(path, **arrays)
    except Exception:
        log.exception("Saving the forecasts failed.", path=str(path))
        raise
    else:
        log.info("Saving the forecasts succeeded.", path=str(path))


def load_artifact(
    path: Path, *, log: Logger
) -> tuple[dict[str, ExperimentResult], FloatArray]:
    """Reads back what save_artifact wrote."""
    try:
        log.info("Loading the forecasts...", path=str(path))
        with np.load(path, allow_pickle=False) as data:
            scores: dict[str, dict[str, float]] = json.loads(str(data["__scores__"]))
            repeat: FloatArray = data["__determinism_repeat__"]
            results = {
                name: ExperimentResult(
                    points=data[f"{name}::points"],
                    quantiles=data[f"{name}::quantiles"],
                    scores=Scores(**scores[name]),
                )
                for name in scores
            }
    except Exception as err:
        log.exception("Loading the forecasts failed.", path=str(path))
        raise ArtifactError(
            f"no usable forecasts at {path} - run `uv run app backtest` first"
        ) from err
    else:
        log.info("Loading the forecasts succeeded.", configurations=len(results))
        return results, repeat
