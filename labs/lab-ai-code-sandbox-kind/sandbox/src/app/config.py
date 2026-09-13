"""Sandbox settings read once from the environment."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from app.errors import ConfigError


@dataclass(frozen=True)
class Settings:
    """Every tunable the sandbox reads; defaults are the documented limits."""

    host: str
    port: int
    work_root: Path
    execution_timeout_seconds: float
    max_code_bytes: int
    max_output_bytes: int
    max_result_bytes: int
    max_concurrent_executions: int


def _positive(
    env: Mapping[str, str], name: str, default: float, kind: Callable[[str], float]
) -> float:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        value = kind(raw)
    except ValueError as err:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from err
    if value <= 0:
        raise ConfigError(f"{name} must be positive, got {raw!r}")
    return float(value)


def load_settings(env: Mapping[str, str]) -> Settings:
    """Builds Settings from `env`, raising ConfigError on bad values."""
    return Settings(
        # Binding all interfaces is intended: the pod network is the boundary.
        host=env.get("HOST", "0.0.0.0"),
        port=int(_positive(env, "PORT", 8000, int)),
        work_root=Path(env.get("WORK_ROOT", "/work")),
        execution_timeout_seconds=_positive(
            env, "EXECUTION_TIMEOUT_SECONDS", 30.0, float
        ),
        max_code_bytes=int(_positive(env, "MAX_CODE_BYTES", 65536, int)),
        max_output_bytes=int(_positive(env, "MAX_OUTPUT_BYTES", 65536, int)),
        max_result_bytes=int(_positive(env, "MAX_RESULT_BYTES", 65536, int)),
        max_concurrent_executions=int(
            _positive(env, "MAX_CONCURRENT_EXECUTIONS", 20, int)
        ),
    )
