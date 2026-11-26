"""The app's exception hierarchy. Every deliberate failure is one of these."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every failure this app raises on purpose."""


class FetchError(LabError):
    """An upstream endpoint returned nothing usable."""


class TruthError(LabError):
    """The ground-truth file is missing, malformed, or inconsistent."""


class AnswerFormatError(LabError):
    """A research answer does not follow the required answer format."""


class LdrError(LabError):
    """The local deep-research service failed or returned no result."""


class GeminiError(LabError):
    """The Gemini deep-research agent failed or returned no result."""


class RunStoreError(LabError):
    """A stored run file is missing, malformed, or cannot be written."""


class ConfigError(LabError):
    """The environment or command-line configuration is unusable."""
