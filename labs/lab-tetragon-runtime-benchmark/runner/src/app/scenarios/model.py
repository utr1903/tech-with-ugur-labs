"""Scenario definitions and the signals that count as detection."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class Matcher:
    """One event pattern; every set field must match for it to fire."""

    kind: Literal["exec", "kprobe"]
    policy: str | None
    binary_prefix: str | None
    binary_regex: str | None
    args_regex: str | None


@dataclass(frozen=True)
class Scenario:
    """One attack (or benign) scenario loaded from its scenario.yaml."""

    id: str
    name: str
    tactic: str
    pod: str
    namespace: str
    benign: bool
    expected_tuned: Literal["detect", "miss"]
    expected_enforce: Literal["block", "detect", "none"]
    requires: tuple[str, ...]
    signals: tuple[Matcher, ...]
    directory: Path
