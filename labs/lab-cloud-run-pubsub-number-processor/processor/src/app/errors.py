"""The processor's deliberate failure hierarchy."""

from __future__ import annotations


class LabError(Exception):
    """Base class for failures raised deliberately by the processor."""


class MalformedMessageError(LabError):
    """A Pub/Sub delivery cannot be decoded into a supported number."""


class StorageError(LabError):
    """A qualifying number could not be stored."""
