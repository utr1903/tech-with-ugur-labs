"""The app's exception hierarchy. Every deliberate failure is one of these."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every failure this app raises on purpose."""


class ScenarioError(LabError):
    """A scenario definition is missing, malformed, or failed to run."""


class MarkerMissingError(LabError):
    """A scenario script exited before printing its BENCH_ACTION marker."""


class KubeError(LabError):
    """A kubectl call failed or returned something unusable."""


class PolicyError(LabError):
    """A tracing policy could not be rendered or applied."""


class ExpectationError(LabError):
    """A behaviour scenario did not produce the expected outcome."""
