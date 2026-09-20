"""Turn `scenario.yaml` into the frozen `Scenario` the rest of the lab uses.

Each block of the file gets one small parser below, and each parser reads
its leaves through `scenario_fields.py`, so a failure always names the full
YAML path — `desk_limits.name_gross_cap`, not "bad value".

The file is read with `yaml.safe_load`, which constructs only plain strings,
numbers, lists and mappings. A document carrying a Python object tag is
rejected rather than executed.

This module only proves the document has the right shape. Whether the
numbers make sense together is `validation.py`'s job, and `load_scenario`
hands the result over before returning it.
"""

from __future__ import annotations

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
from app.market_moments import market_factor_moments
from app.scenario_fields import (
    ALGORITHM_KEYS,
    FRONTIER_KEYS,
    LIMIT_KEYS,
    MARKET_KEYS,
    NAME_KEYS,
    ROOT_KEYS,
    STUDY_KEYS,
    TOLERANCE_KEYS,
    UNIVERSE_KEYS,
    as_integer,
    as_integer_tuple,
    as_mapping,
    as_number,
    as_optional_path,
    as_sequence,
    as_text,
    as_text_tuple,
    peek_field,
)
from app.validation import validate_scenario

_NAME_COLUMNS = (
    "market_beta",
    "alpha_monthly",
    "borrow_fee_annual",
    "half_spread",
    "start_weight",
)


def _parse_universe(value: object, market_factor_mean: float) -> Universe:
    """Build the universe, deriving `expected_return` from alpha and beta."""
    section = as_mapping(value, "universe", UNIVERSE_KEYS)
    sectors = as_text_tuple(section["sectors"], "universe.sectors")
    entries = as_sequence(section["names"], "universe.names")

    names: list[str] = []
    sector_of: list[int] = []
    columns: dict[str, list[float]] = {key: [] for key in _NAME_COLUMNS}
    for index, raw in enumerate(entries):
        located = f"universe.names[{index}]"
        name = as_text(peek_field(raw, "name", located), f"{located}.name")
        path = f"universe.names.{name}"
        entry = as_mapping(raw, path, NAME_KEYS)
        sector = as_text(entry["sector"], f"{path}.sector")
        if sector not in sectors:
            raise ScenarioError(
                f"{path}.sector is {sector!r}, which is not one of universe.sectors"
            )
        names.append(name)
        sector_of.append(sectors.index(sector))
        for key in columns:
            columns[key].append(as_number(entry[key], f"{path}.{key}"))

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


def _parse_limits(value: object) -> DeskLimits:
    """Read the desk mandate."""
    section = as_mapping(value, "desk_limits", LIMIT_KEYS)

    def limit(key: str) -> float:
        return as_number(section[key], f"desk_limits.{key}")

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
    section = as_mapping(value, "market", MARKET_KEYS)

    def whole(key: str) -> int:
        return as_integer(section[key], f"market.{key}")

    def real(key: str) -> float:
        return as_number(section[key], f"market.{key}")

    return GeneratorSettings(
        mode=as_text(section["mode"], "market.mode"),
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
        jump_names=as_text_tuple(section["jump_names"], "market.jump_names"),
    )


def _parse_frontier(value: object) -> FrontierSettings:
    """Read the return-target sweep."""
    section = as_mapping(value, "frontier", FRONTIER_KEYS)
    return FrontierSettings(
        points=as_integer(section["points"], "frontier.points"),
        min_target_monthly=as_number(
            section["min_target_monthly"], "frontier.min_target_monthly"
        ),
        max_target_monthly=as_number(
            section["max_target_monthly"], "frontier.max_target_monthly"
        ),
    )


def _parse_algorithms(value: object) -> AlgorithmSettings:
    """Read the solver bake-off settings."""
    section = as_mapping(value, "algorithms", ALGORITHM_KEYS)
    return AlgorithmSettings(
        scenario_ladder=as_integer_tuple(
            section["scenario_ladder"], "algorithms.scenario_ladder"
        ),
        objective_relative_tolerance=as_number(
            section["objective_relative_tolerance"],
            "algorithms.objective_relative_tolerance",
        ),
    )


def _parse_studies(value: object) -> StudySettings:
    """Read the comparison-study settings."""
    section = as_mapping(value, "studies", STUDY_KEYS)
    return StudySettings(
        seeds=as_integer(section["seeds"], "studies.seeds"),
        scenarios=as_integer(section["scenarios"], "studies.scenarios"),
        matched_target_monthly=as_number(
            section["matched_target_monthly"], "studies.matched_target_monthly"
        ),
        elliptical_weight_tolerance=as_number(
            section["elliptical_weight_tolerance"],
            "studies.elliptical_weight_tolerance",
        ),
        divergence_ratio_min=as_number(
            section["divergence_ratio_min"], "studies.divergence_ratio_min"
        ),
    )


def _parse_tolerances(value: object) -> Tolerances:
    """Read the per-check numerical slack."""
    section = as_mapping(value, "tolerances", TOLERANCE_KEYS)

    def slack(key: str) -> float:
        return as_number(section[key], f"tolerances.{key}")

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
    root = as_mapping(document, "scenario", ROOT_KEYS)
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
        cvar_beta=as_number(root["cvar_beta"], "cvar_beta"),
        headline_target_monthly=as_number(
            root["headline_target_monthly"], "headline_target_monthly"
        ),
        returns_csv=as_optional_path(root["returns_csv"], "returns_csv"),
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
