from __future__ import annotations

import platform
from importlib import metadata

import pytest

from app.capabilities.report import (
    PROMISED_MODULES,
    build_capabilities,
    capabilities_to_json,
)
from app.config import load_settings
from app.errors import CapabilitiesError
from app.logging_setup import get_logger


def test_reports_every_promised_module_with_its_installed_version() -> None:
    report = build_capabilities(load_settings({}), log=get_logger(app_name="t"))
    names = [m.import_name for m in report.modules]
    assert names == ["numpy", "pandas", "scipy", "sympy", "sklearn"]
    for module in report.modules:
        assert module.version == metadata.version(module.distribution)
    assert report.python_version == platform.python_version()


def test_json_is_camel_case_with_limits() -> None:
    settings = load_settings({"EXECUTION_TIMEOUT_SECONDS": "12"})
    body = capabilities_to_json(
        build_capabilities(settings, log=get_logger(app_name="t"))
    )
    assert body["limits"] == {
        "executionTimeoutSeconds": 12.0,
        "maxCodeBytes": 65536,
        "maxStdoutBytes": 65536,
        "maxStderrBytes": 65536,
        "maxResultBytes": 65536,
        "maxConcurrentExecutions": 20,
    }
    modules = body["modules"]
    assert isinstance(modules, list)
    assert modules[4] == {
        "importName": "sklearn",
        "distribution": "scikit-learn",
        "version": metadata.version("scikit-learn"),
    }
    assert "result.json" in str(body["structuredResult"])
    assert "network" in str(body["network"]).lower()
    assert str(body["persistence"])


def test_missing_module_is_a_capabilities_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.capabilities.report.PROMISED_MODULES",
        (*PROMISED_MODULES, ("no-such-distribution-xyz", "nosuch")),
    )
    with pytest.raises(CapabilitiesError, match="no-such-distribution-xyz"):
        build_capabilities(load_settings({}), log=get_logger(app_name="t"))
