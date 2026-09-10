"""The float32 array alias shared by the forecast and eval domains."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

# The forecast arrays are float32 end to end: windows.context_block and
# horizon_block both finish with astype/ascontiguousarray(dtype=np.float32),
# and everything downstream inherits it.
type FloatArray = npt.NDArray[np.float32]
