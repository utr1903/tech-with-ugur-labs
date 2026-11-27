"""The app's exception hierarchy. Every deliberate failure is one of these."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every failure this app raises on purpose."""


class FixtureError(LabError):
    """A fixture file cannot be generated, read, or is inconsistent."""


class HermesError(LabError):
    """The Hermes Agent API failed or returned something unusable."""


class ReportError(LabError):
    """A triage report is missing, malformed, or cannot be scored."""


class LeakError(LabError):
    """A secret or forbidden value was found where it must not be."""


class ConfigError(LabError):
    """The environment or command-line configuration is unusable."""
