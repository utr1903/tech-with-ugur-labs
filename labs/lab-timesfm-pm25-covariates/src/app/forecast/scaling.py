"""Putting covariate channels on a common scale.

Surface pressure sits near 1000 hPa while precipitation is usually 0.0.
Handing those to the model unscaled lets the largest-magnitude channel
dominate for reasons of units rather than physics, so each channel is
standardised independently: subtract its mean, divide by its standard
deviation.

The statistics come from the context hours ONLY. A past-and-future covariate
block extends one horizon past the origin, and computing its mean over the
horizon too would fold information about the future into the scaling of the
inputs - the forecast would improve, and the improvement would be an
artefact. This lab exists partly to show what leakage looks like; it takes
care not to commit it by accident while doing so.

See docs/METHOD.md section 5.2.
"""

from __future__ import annotations

import numpy as np

from app.lib.arrays import FloatArray

_MIN_SD = 1e-6


def standardize_channels(block: FloatArray, n_context: int) -> FloatArray:
    """Standardises each row of `block` using its first `n_context` values.

    `axis=1` with `keepdims=True` gives one mean and one standard deviation
    per channel, shaped (channels, 1), which broadcasts back across time.
    Using axis=0 would standardise across channels at each timestep - mixing
    pressure with rainfall - which is meaningless.

    The `_MIN_SD` floor keeps a channel that never moves inside its context
    from dividing by zero and seeding inf/nan through the whole forecast. It
    is defensive: across the 90 origins in this window the smallest context
    standard deviation of any channel is 0.043, so it never actually fires
    here.
    """
    context = block[:, :n_context]
    mean = context.mean(axis=1, keepdims=True)
    sd = np.maximum(context.std(axis=1, keepdims=True), _MIN_SD)
    scaled: FloatArray = ((block - mean) / sd).astype(np.float32)
    return scaled
