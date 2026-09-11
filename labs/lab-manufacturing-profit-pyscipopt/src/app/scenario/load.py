"""Safe loading from named YAML mappings into immutable scenario arrays."""

from __future__ import annotations

from pathlib import Path

import yaml

from app.contracts import Scenario
from app.errors import ScenarioError
from app.logging_setup import Logger
from app.scenario.construction import construct_scenario
from app.scenario.validation import validate_scenario


def load_scenario(
    path: Path, *, log: Logger, input_bytes: bytes | None = None
) -> Scenario:
    """Load, convert, and validate one YAML scenario."""
    log.info("Loading scenario...", path=str(path))
    try:
        raw = yaml.safe_load(path.read_bytes() if input_bytes is None else input_bytes)
        scenario = construct_scenario(raw)
        validate_scenario(scenario)
    except ScenarioError:
        log.exception("Loading scenario failed.", path=str(path))
        raise
    except (OSError, yaml.YAMLError) as err:
        log.exception("Loading scenario failed.", path=str(path))
        raise ScenarioError(f"scenario: could not load {path}") from err
    except Exception:
        log.exception("Loading scenario failed.", path=str(path))
        raise
    else:
        log.info("Loading scenario succeeded.", path=str(path))
        return scenario
