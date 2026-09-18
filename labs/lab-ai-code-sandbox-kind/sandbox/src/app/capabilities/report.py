"""Builds the /capabilities document from the running image and settings."""

from __future__ import annotations

import platform
from dataclasses import dataclass
from importlib import metadata

from app.config import Settings
from app.errors import CapabilitiesError
from app.logging_setup import Logger

# (distribution name, import name) for every module the tool promises.
PROMISED_MODULES: tuple[tuple[str, str], ...] = (
    ("numpy", "numpy"),
    ("pandas", "pandas"),
    ("scipy", "scipy"),
    ("sympy", "sympy"),
    ("scikit-learn", "sklearn"),
)

NETWORK_STATEMENT = (
    "No network use is expected: do not download data, install packages or "
    "call external services."
)
PERSISTENCE_STATEMENT = (
    "Every execution starts a fresh interpreter in a fresh, empty working "
    "directory; no files, variables or imports survive between executions."
)


@dataclass(frozen=True)
class ModuleInfo:
    """One installed module the sandbox promises."""

    import_name: str
    distribution: str
    version: str


@dataclass(frozen=True)
class Capabilities:
    """Everything a caller needs to describe the sandbox truthfully."""

    python_version: str
    modules: tuple[ModuleInfo, ...]
    settings: Settings


def build_capabilities(settings: Settings, *, log: Logger) -> Capabilities:
    """Reads installed versions; raises CapabilitiesError if one is missing."""
    try:
        log.info("Building capabilities...", modules=len(PROMISED_MODULES))
        modules = tuple(
            ModuleInfo(
                import_name=imp, distribution=dist, version=metadata.version(dist)
            )
            for dist, imp in PROMISED_MODULES
        )
    except metadata.PackageNotFoundError as err:
        log.exception("Building capabilities failed.")
        raise CapabilitiesError(f"promised module is not installed: {err}") from err
    else:
        log.info(
            "Building capabilities succeeded.", modules=[m.import_name for m in modules]
        )
        return Capabilities(
            python_version=platform.python_version(), modules=modules, settings=settings
        )


def capabilities_to_json(capabilities: Capabilities) -> dict[str, object]:
    """The camelCase wire form of the capabilities document."""
    settings = capabilities.settings
    return {
        "pythonVersion": capabilities.python_version,
        "modules": [
            {
                "importName": m.import_name,
                "distribution": m.distribution,
                "version": m.version,
            }
            for m in capabilities.modules
        ],
        "limits": {
            "executionTimeoutSeconds": settings.execution_timeout_seconds,
            "maxCodeBytes": settings.max_code_bytes,
            "maxStdoutBytes": settings.max_output_bytes,
            "maxStderrBytes": settings.max_output_bytes,
            "maxResultBytes": settings.max_result_bytes,
            "maxConcurrentExecutions": settings.max_concurrent_executions,
        },
        "network": NETWORK_STATEMENT,
        "persistence": PERSISTENCE_STATEMENT,
        "structuredResult": (
            "To return structured data, write one JSON document to result.json "
            f"in the working directory (at most {settings.max_result_bytes} "
            "bytes); it comes back parsed as `result`, or `resultError` "
            "explains why it was rejected."
        ),
    }
