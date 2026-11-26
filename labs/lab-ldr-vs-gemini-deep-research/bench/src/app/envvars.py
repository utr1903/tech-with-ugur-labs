"""Reading typed settings from environment variables."""

from __future__ import annotations

from collections.abc import Mapping

from app.errors import ConfigError


def number_from_env(env: Mapping[str, str], name: str, default: float) -> float:
    """The variable as a float; unset or blank gives `default`."""
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError as err:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from err
