"""The application exception hierarchy."""

from __future__ import annotations


class LabError(Exception):
    """Base class for every deliberate application failure."""


class ScenarioError(LabError):
    """The scenario is missing, malformed, or semantically inconsistent."""


class MarketError(LabError):
    """The return-scenario generator or loader could not produce a usable matrix."""


class ModelError(LabError):
    """A CVXPY problem could not be built."""


class SolveError(LabError):
    """A built problem could not be solved at all (solver error, not infeasibility)."""


class InfeasibleError(LabError):
    """The solver reported an infeasible or unbounded status."""


class VerificationError(LabError):
    """An extracted solution failed independent verification."""


class ArtifactError(LabError):
    """A result artifact could not be written."""
