"""Turn `scenario.yaml` into the frozen `Scenario` the rest of the lab uses.

Parsing is deliberately unforgiving. Every mapping must hold exactly the
documented keys, every number must be a finite non-boolean, and every array
is copied and made read-only before it enters a dataclass. A failure names
the full YAML path — `desk_limits.name_gross_cap`, not "bad value" — so the
message points at the line to edit.

The file is read with `yaml.safe_load`, which constructs only plain
strings, numbers, lists and mappings. A document carrying a Python object
tag is rejected rather than executed.

Semantic rules live next door in `validation.py`; this module only proves
the document has the right shape and then hands the result over.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import isfinite
from pathlib import Path

import numpy as np
import yaml

from app.contracts import (
    AlgorithmSettings,
    DeskLimits,
    FrontierSettings,
    GeneratorSettings,
    Scenario,
    StudySettings,
    Tolerances,
    Universe,
    frozen_float_array,
    frozen_int_array,
)
from app.errors import ScenarioError
from app.logging_setup import Logger
from app.market import market_factor_moments
from app.validation import validate_scenario

_ROOT_KEYS = frozenset(
    {
        "cvar_beta",
        "headline_target_monthly",
        "returns_csv",
        "universe",
        "desk_limits",
        "market",
        "frontier",
        "algorithms",
        "studies",
        "tolerances",
    }
)
_UNIVERSE_KEYS = frozenset({"sectors", "names"})
_NAME_KEYS = frozenset(
    {
        "name",
        "sector",
        "market_beta",
        "alpha_monthly",
        "borrow_fee_annual",
        "half_spread",
        "start_weight",
    }
)
_LIMIT_KEYS = frozenset(
    {
        "gross_leverage_max",
        "net_exposure_min",
        "net_exposure_max",
        "beta_min",
        "beta_max",
        "name_gross_cap",
        "sector_net_cap",
        "sector_gross_cap",
        "turnover_max",
    }
)
_MARKET_KEYS = frozenset(
    {
        "mode",
        "seed",
        "scenarios",
        "out_of_sample_seed",
        "out_of_sample_scenarios",
        "factor_count",
        "calm_sigma",
        "stress_probability",
        "stress_mean",
        "stress_sigma",
        "idiosyncratic_df",
        "idiosyncratic_sigma",
        "jump_probability",
        "jump_mean",
        "jump_sigma",
        "jump_names",
    }
)
_FRONTIER_KEYS = frozenset({"points", "min_target_monthly", "max_target_monthly"})
_ALGORITHM_KEYS = frozenset({"scenario_ladder", "objective_relative_tolerance"})
_STUDY_KEYS = frozenset(
    {
        "seeds",
        "scenarios",
        "matched_target_monthly",
        "elliptical_weight_tolerance",
        "divergence_ratio_min",
    }
)
_TOLERANCE_KEYS = frozenset(
    {
        "constraint_abs",
        "cvar_agreement_abs",
        "var_recovery_abs",
        "solver_agreement_rel",
        "relaxation_abs",
        "dual_relative",
    }
)


def _mapping(value: object, path: str, keys: frozenset[str]) -> Mapping[str, object]:
    """Return a mapping only when it holds exactly the documented keys."""
    if not isinstance(value, Mapping):
        raise ScenarioError(f"{path} must be a mapping, got {type(value).__name__}")
    present = {str(key): item for key, item in value.items()}
    missing = sorted(f"{path}.{key}" for key in keys - present.keys())
    if missing:
        raise ScenarioError(f"{path} is missing required field(s): {missing}")
    unknown = sorted(f"{path}.{key}" for key in present.keys() - keys)
    if unknown:
        raise ScenarioError(f"{path} has unexpected field(s): {unknown}")
    return present


def _number(value: object, path: str) -> float:
    """Return a finite float, rejecting booleans, strings and NaN alike."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScenarioError(f"{path} must be a number, got {type(value).__name__}")
    result = float(value)
    if not isfinite(result):
        raise ScenarioError(f"{path} must be finite, got {value}")
    return result


def _integer(value: object, path: str) -> int:
    """Return a whole number, rejecting booleans and fractional values."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScenarioError(f"{path} must be an integer, got {type(value).__name__}")
    return value


def _text(value: object, path: str) -> str:
    """Return a non-empty string, rejecting numbers YAML happened to parse."""
    if not isinstance(value, str) or not value.strip():
        raise ScenarioError(f"{path} must be a non-empty string")
    return value.strip()


def _sequence(value: object, path: str) -> Sequence[object]:
    """Return a YAML list, rejecting a bare scalar or a mapping."""
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ScenarioError(f"{path} must be a list, got {type(value).__name__}")
    return value


def _text_tuple(value: object, path: str) -> tuple[str, ...]:
    """Return a list of strings with each element's index in its own path."""
    items = _sequence(value, path)
    return tuple(_text(item, f"{path}[{index}]") for index, item in enumerate(items))


def _integer_tuple(value: object, path: str) -> tuple[int, ...]:
    """Return a list of integers with each element's index in its own path."""
    items = _sequence(value, path)
    return tuple(_integer(item, f"{path}[{index}]") for index, item in enumerate(items))


def _optional_path(value: object, path: str) -> Path | None:
    """Return a filesystem path, or `None` for the generated-market default."""
    if value is None:
        return None
    return Path(_text(value, path))


def _parse_universe(value: object, market_factor_mean: float) -> Universe:
    """Build the universe, deriving `expected_return` from alpha and beta."""
    section = _mapping(value, "universe", _UNIVERSE_KEYS)
    sectors = _text_tuple(section["sectors"], "universe.sectors")
    entries = _sequence(section["names"], "universe.names")

    names: list[str] = []
    sector_of: list[int] = []
    columns: dict[str, list[float]] = {
        key: []
        for key in (
            "market_beta",
            "alpha_monthly",
            "borrow_fee_annual",
            "half_spread",
            "start_weight",
        )
    }
    for index, raw in enumerate(entries):
        located = f"universe.names[{index}]"
        name = _text(_lookup(raw, "name", located), f"{located}.name")
        path = f"universe.names.{name}"
        entry = _mapping(raw, path, _NAME_KEYS)
        sector = _text(entry["sector"], f"{path}.sector")
        if sector not in sectors:
            raise ScenarioError(
                f"{path}.sector is {sector!r}, which is not one of universe.sectors"
            )
        names.append(name)
        sector_of.append(sectors.index(sector))
        for key in columns:
            columns[key].append(_number(entry[key], f"{path}.{key}"))

    matrix = np.zeros((len(sectors), len(names)), dtype=np.float64)
    matrix[sector_of, np.arange(len(names))] = 1.0
    beta = np.array(columns["market_beta"], dtype=np.float64)
    alpha = np.array(columns["alpha_monthly"], dtype=np.float64)
    return Universe(
        names=tuple(names),
        sectors=sectors,
        sector_of=frozen_int_array(sector_of),
        sector_matrix=frozen_float_array(matrix),
        market_beta=frozen_float_array(beta),
        expected_return=frozen_float_array(alpha + beta * market_factor_mean),
        borrow_fee_annual=frozen_float_array(columns["borrow_fee_annual"]),
        half_spread=frozen_float_array(columns["half_spread"]),
        start_book=frozen_float_array(columns["start_weight"]),
    )


def _lookup(raw: object, key: str, path: str) -> object:
    """Read one key out of a mapping before its exact key set is known."""
    if not isinstance(raw, Mapping) or key not in raw:
        raise ScenarioError(f"{path} must be a mapping holding a {key!r} field")
    return raw[key]


def _parse_limits(value: object) -> DeskLimits:
    """Read the desk mandate."""
    section = _mapping(value, "desk_limits", _LIMIT_KEYS)

    def limit(key: str) -> float:
        return _number(section[key], f"desk_limits.{key}")

    return DeskLimits(
        gross_leverage_max=limit("gross_leverage_max"),
        net_exposure_min=limit("net_exposure_min"),
        net_exposure_max=limit("net_exposure_max"),
        beta_min=limit("beta_min"),
        beta_max=limit("beta_max"),
        name_gross_cap=limit("name_gross_cap"),
        sector_net_cap=limit("sector_net_cap"),
        sector_gross_cap=limit("sector_gross_cap"),
        turnover_max=limit("turnover_max"),
    )


def _parse_market(value: object) -> GeneratorSettings:
    """Read the generator settings, keeping seeds and counts integral."""
    section = _mapping(value, "market", _MARKET_KEYS)

    def whole(key: str) -> int:
        return _integer(section[key], f"market.{key}")

    def real(key: str) -> float:
        return _number(section[key], f"market.{key}")

    return GeneratorSettings(
        mode=_text(section["mode"], "market.mode"),
        seed=whole("seed"),
        scenarios=whole("scenarios"),
        out_of_sample_seed=whole("out_of_sample_seed"),
        out_of_sample_scenarios=whole("out_of_sample_scenarios"),
        factor_count=whole("factor_count"),
        calm_sigma=real("calm_sigma"),
        stress_probability=real("stress_probability"),
        stress_mean=real("stress_mean"),
        stress_sigma=real("stress_sigma"),
        idiosyncratic_df=real("idiosyncratic_df"),
        idiosyncratic_sigma=real("idiosyncratic_sigma"),
        jump_probability=real("jump_probability"),
        jump_mean=real("jump_mean"),
        jump_sigma=real("jump_sigma"),
        jump_names=_text_tuple(section["jump_names"], "market.jump_names"),
    )


def _parse_frontier(value: object) -> FrontierSettings:
    """Read the return-target sweep."""
    section = _mapping(value, "frontier", _FRONTIER_KEYS)
    return FrontierSettings(
        points=_integer(section["points"], "frontier.points"),
        min_target_monthly=_number(
            section["min_target_monthly"], "frontier.min_target_monthly"
        ),
        max_target_monthly=_number(
            section["max_target_monthly"], "frontier.max_target_monthly"
        ),
    )


def _parse_algorithms(value: object) -> AlgorithmSettings:
    """Read the solver bake-off settings."""
    section = _mapping(value, "algorithms", _ALGORITHM_KEYS)
    return AlgorithmSettings(
        scenario_ladder=_integer_tuple(
            section["scenario_ladder"], "algorithms.scenario_ladder"
        ),
        objective_relative_tolerance=_number(
            section["objective_relative_tolerance"],
            "algorithms.objective_relative_tolerance",
        ),
    )


def _parse_studies(value: object) -> StudySettings:
    """Read the comparison-study settings."""
    section = _mapping(value, "studies", _STUDY_KEYS)
    return StudySettings(
        seeds=_integer(section["seeds"], "studies.seeds"),
        scenarios=_integer(section["scenarios"], "studies.scenarios"),
        matched_target_monthly=_number(
            section["matched_target_monthly"], "studies.matched_target_monthly"
        ),
        elliptical_weight_tolerance=_number(
            section["elliptical_weight_tolerance"],
            "studies.elliptical_weight_tolerance",
        ),
        divergence_ratio_min=_number(
            section["divergence_ratio_min"], "studies.divergence_ratio_min"
        ),
    )


def _parse_tolerances(value: object) -> Tolerances:
    """Read the per-check numerical slack."""
    section = _mapping(value, "tolerances", _TOLERANCE_KEYS)

    def slack(key: str) -> float:
        return _number(section[key], f"tolerances.{key}")

    return Tolerances(
        constraint_abs=slack("constraint_abs"),
        cvar_agreement_abs=slack("cvar_agreement_abs"),
        var_recovery_abs=slack("var_recovery_abs"),
        solver_agreement_rel=slack("solver_agreement_rel"),
        relaxation_abs=slack("relaxation_abs"),
        dual_relative=slack("dual_relative"),
    )


def _parse_document(document: object) -> Scenario:
    """Turn one parsed YAML document into a validated scenario."""
    root = _mapping(document, "scenario", _ROOT_KEYS)
    market = _parse_market(root["market"])
    market_factor_mean, _ = market_factor_moments(market)
    scenario = Scenario(
        universe=_parse_universe(root["universe"], market_factor_mean),
        limits=_parse_limits(root["desk_limits"]),
        market=market,
        frontier=_parse_frontier(root["frontier"]),
        algorithms=_parse_algorithms(root["algorithms"]),
        studies=_parse_studies(root["studies"]),
        tolerances=_parse_tolerances(root["tolerances"]),
        cvar_beta=_number(root["cvar_beta"], "cvar_beta"),
        headline_target_monthly=_number(
            root["headline_target_monthly"], "headline_target_monthly"
        ),
        returns_csv=_optional_path(root["returns_csv"], "returns_csv"),
    )
    validate_scenario(scenario)
    return scenario


def load_scenario(path: Path, *, log: Logger) -> Scenario:
    """Read, parse and validate one YAML scenario file.

    Args:
        path: The YAML file to read.
        log: Logger for the operation boundary.

    Returns:
        A frozen scenario whose arrays are read-only copies.

    Raises:
        ScenarioError: If the file cannot be read or decoded, the YAML
            cannot be parsed safely, a field is missing, unexpected or the
            wrong type, or a semantic rule in `validation.py` fails.
    """
    try:
        log.info("Loading scenario...", path=str(path))
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        scenario = _parse_document(document)
    except ScenarioError:
        log.exception("Loading scenario failed.", path=str(path))
        raise
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as err:
        log.exception("Loading scenario failed.", path=str(path))
        raise ScenarioError(f"could not load a scenario from {path}") from err
    else:
        log.info(
            "Loading scenario succeeded.",
            path=str(path),
            names=len(scenario.universe.names),
            sectors=len(scenario.universe.sectors),
            mode=scenario.market.mode,
        )
        return scenario
