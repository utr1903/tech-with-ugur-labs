"""Which risky settings a service config contains."""

from __future__ import annotations

from collections.abc import Callable, Mapping

from app.fixtures.versions import compare_versions

RISKY_FLAGS: tuple[str, ...] = (
    "debug",
    "tls_min_version",
    "cors_wildcard",
    "admin_public",
    "auth_disabled",
)


def _section(config: Mapping[str, object], name: str) -> Mapping[str, object]:
    value = config.get(name)
    return value if isinstance(value, Mapping) else {}


def _tls_is_old(config: Mapping[str, object]) -> bool:
    minimum = _section(config, "tls").get("min_version")
    return isinstance(minimum, str) and compare_versions(minimum, "1.2") < 0


def _cors_is_open(config: Mapping[str, object]) -> bool:
    origins = _section(config, "cors").get("allow_origins")
    return isinstance(origins, list) and "*" in origins


_FLAG_RULES: dict[str, Callable[[Mapping[str, object]], bool]] = {
    "debug": lambda config: config.get("debug") is True,
    "tls_min_version": _tls_is_old,
    "cors_wildcard": _cors_is_open,
    "admin_public": lambda config: _section(config, "admin").get("bind") == "0.0.0.0",
    "auth_disabled": lambda config: _section(config, "auth").get("enabled") is False,
}


def risky_flags(config: Mapping[str, object]) -> frozenset[str]:
    """The names of every risky setting present in a service config."""
    return frozenset(name for name, rule in _FLAG_RULES.items() if rule(config))
