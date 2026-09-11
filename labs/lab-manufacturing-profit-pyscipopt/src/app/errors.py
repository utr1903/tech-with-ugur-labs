"""The application exception hierarchy."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every deliberate application failure."""


class ScenarioError(LabError):
    """The scenario is missing, malformed, or physically inconsistent."""


class ModelError(LabError):
    """The optimization model could not be built or solved."""


class NoIncumbentError(LabError):
    """The solver returned no feasible incumbent."""


class VerificationError(LabError):
    """An extracted incumbent failed independent verification."""


class ArtifactError(LabError):
    """A result artifact could not be written."""
