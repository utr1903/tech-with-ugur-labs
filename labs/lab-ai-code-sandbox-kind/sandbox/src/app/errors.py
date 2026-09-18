"""The sandbox's exception hierarchy. Every deliberate failure is one of these."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every failure this app raises on purpose."""


class ConfigError(LabError):
    """An environment variable is missing or malformed."""


class CapabilitiesError(LabError):
    """A promised compute module is not installed in this image."""


class ExecutionError(LabError):
    """A subprocess did not come up the way the runner requires."""
