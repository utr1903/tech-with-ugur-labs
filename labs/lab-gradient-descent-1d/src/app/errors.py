"""Named failures raised by the lab."""

from __future__ import annotations


class LabError(Exception):
    """Base class for deliberate lab failures."""


class ExperimentError(LabError):
    """An experiment input or computed state is invalid."""
