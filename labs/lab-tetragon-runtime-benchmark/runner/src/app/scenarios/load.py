"""Loads and validates scenario folders from disk."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import yaml

from app.errors import ScenarioError
from app.logging_setup import Logger
from app.scenarios.model import Matcher, Scenario

_SCRIPTS = ("run.sh", "check.sh", "cleanup.sh")
_TUNED: dict[str, Literal["detect", "miss"]] = {"detect": "detect", "miss": "miss"}
_ENFORCE: dict[str, Literal["block", "detect", "none"]] = {
    "block": "block",
    "detect": "detect",
    "none": "none",
}
_KINDS: dict[str, Literal["exec", "kprobe"]] = {"exec": "exec", "kprobe": "kprobe"}
_REGEX_FIELDS = ("binary_regex", "args_regex")
_MATCHER_FIELDS = ("policy", "binary_prefix", "binary_regex", "args_regex")


def _str_field(data: dict[str, object], key: str, where: Path) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise ScenarioError(f"{where}: field '{key}' is missing or not a string")
    return value


def _choice[T](value: object, allowed: dict[str, T], what: str, where: Path) -> T:
    if not isinstance(value, str) or value not in allowed:
        options = tuple(allowed)
        raise ScenarioError(f"{where}: {what} must be one of {options}, got {value!r}")
    return allowed[value]


def _mapping(value: object, what: str, where: Path) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ScenarioError(f"{where}: {what} must be a mapping")
    return {str(key): item for key, item in value.items()}


def _optional_str(entry: dict[str, object], key: str, where: Path) -> str | None:
    value = entry.get(key)
    if value is not None and not isinstance(value, str):
        raise ScenarioError(f"{where}: signal field '{key}' must be a string")
    return value


def _regex_field(entry: dict[str, object], key: str, where: Path) -> str | None:
    value = _optional_str(entry, key, where)
    if value is not None:
        try:
            re.compile(value)
        except re.error as err:
            raise ScenarioError(
                f"{where}: signal field '{key}' is not a valid regex: {err}"
            ) from err
    return value


def _parse_signal(raw: object, where: Path) -> Matcher:
    entry = _mapping(raw, "signal", where)
    kind = _choice(entry.get("kind"), _KINDS, "signal kind", where)
    fields = {key: _optional_str(entry, key, where) for key in _MATCHER_FIELDS}
    for key in _REGEX_FIELDS:
        _regex_field(entry, key, where)
    return Matcher(
        kind=kind,
        policy=fields["policy"],
        binary_prefix=fields["binary_prefix"],
        binary_regex=fields["binary_regex"],
        args_regex=fields["args_regex"],
    )


def _parse_signals(data: dict[str, object], where: Path) -> tuple[Matcher, ...]:
    raw = data.get("signals")
    if not isinstance(raw, list):
        raise ScenarioError(f"{where}: field 'signals' must be a list")
    return tuple(_parse_signal(item, where) for item in raw)


def _parse_requires(data: dict[str, object], where: Path) -> tuple[str, ...]:
    raw = data.get("requires", [])
    if not isinstance(raw, list) or not all(isinstance(i, str) for i in raw):
        raise ScenarioError(f"{where}: field 'requires' must be a list of strings")
    return tuple(str(item) for item in raw)


def _read_yaml(path: Path) -> dict[str, object]:
    try:
        raw = yaml.safe_load(path.read_text())
    except (yaml.YAMLError, OSError) as err:
        raise ScenarioError(f"{path}: cannot read scenario.yaml: {err}") from err
    return _mapping(raw, "document", path)


def _load_one(directory: Path) -> Scenario:
    where = directory / "scenario.yaml"
    for script in _SCRIPTS:
        if not (directory / script).is_file():
            raise ScenarioError(f"{directory}: missing {script}")
    data = _read_yaml(where)
    expected = _mapping(data.get("expected"), "field 'expected'", where)
    benign = data.get("benign", False)
    if not isinstance(benign, bool):
        raise ScenarioError(f"{where}: field 'benign' must be true or false")
    namespace = data.get("namespace", "victim")
    if not isinstance(namespace, str) or not namespace:
        raise ScenarioError(f"{where}: field 'namespace' must be a string")
    tuned = _choice(expected.get("tuned"), _TUNED, "expected.tuned", where)
    enforce = _choice(expected.get("enforce"), _ENFORCE, "expected.enforce", where)
    return Scenario(
        id=_str_field(data, "id", where),
        name=_str_field(data, "name", where),
        tactic=_str_field(data, "tactic", where),
        pod=_str_field(data, "pod", where),
        namespace=namespace,
        benign=benign,
        expected_tuned=tuned,
        expected_enforce=enforce,
        requires=_parse_requires(data, where),
        signals=_parse_signals(data, where),
        directory=directory,
    )


def load_scenarios(root: Path, *, log: Logger) -> tuple[Scenario, ...]:
    """Loads every scenario folder under `root`, sorted by folder name."""
    try:
        log.info("Loading scenarios...", root=str(root))
        folders = sorted(p for p in root.iterdir() if p.is_dir())
        scenarios = tuple(_load_one(folder) for folder in folders)
    except Exception:
        log.exception("Loading scenarios failed.", root=str(root))
        raise
    else:
        log.info("Loading scenarios succeeded.", scenarios=len(scenarios))
        return scenarios
