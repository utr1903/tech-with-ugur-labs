"""Putting covariate channels on a common scale.

Surface pressure sits near 1000 hPa while precipitation is usually 0.0. Handing
those to the model unscaled lets the largest-magnitude channel dominate. Each
channel is standardised independently.

The statistics come from the context hours ONLY. A past-and-future covariate
extends past the origin, and computing its mean over the horizon too would leak
information about the future into the input - the exact mistake this lab exists
to make visible.
"""

from __future__ import annotations

import numpy as np

from app.eval.results import FloatArray

_MIN_SD = 1e-6


def standardize_channels(block: FloatArray, n_context: int) -> FloatArray:
    """Standardises each row of `block` using its first `n_context` values."""
    context = block[:, :n_context]
    mean = context.mean(axis=1, keepdims=True)
    sd = np.maximum(context.std(axis=1, keepdims=True), _MIN_SD)
    scaled: FloatArray = ((block - mean) / sd).astype(np.float32)
    return scaled
