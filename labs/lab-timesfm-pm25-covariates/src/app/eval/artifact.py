"""Persisting and reloading a backtest's forecasts, quantiles and scores."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def save_artifact(path: Path, results: dict, repeat: np.ndarray) -> None:
    """Persists forecasts, quantiles and scores to one npz file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    arrays: dict[str, np.ndarray] = {"__determinism_repeat__": repeat}
    scores = {}
    for name, result in results.items():
        arrays[f"{name}::points"] = result["points"]
        arrays[f"{name}::quantiles"] = result["quantiles"]
        scores[name] = result["scores"]
    arrays["__scores__"] = np.array(json.dumps(scores))
    np.savez_compressed(path, **arrays)


def load_artifact(path: Path) -> tuple[dict, np.ndarray]:
    """Reads back what save_artifact wrote."""
    with np.load(path, allow_pickle=False) as data:
        scores = json.loads(str(data["__scores__"]))
        repeat = data["__determinism_repeat__"]
        results = {
            name: {
                "points": data[f"{name}::points"],
                "quantiles": data[f"{name}::quantiles"],
                "scores": scores[name],
            }
            for name in scores
        }
    return results, repeat
