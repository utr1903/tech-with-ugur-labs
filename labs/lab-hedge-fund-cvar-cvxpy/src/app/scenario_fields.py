"""Reading one YAML leaf at a time, with its full path in every message.

`yaml.safe_load` hands back nested plain Python objects with no shape
guarantees: a number may arrive as a string, a mapping may be missing a
key, a list may be a scalar. These helpers turn one such object into one
typed value, and every one of them takes the field's dotted path so the
error a reader sees is `desk_limits.name_gross_cap must be a number, got
str` rather than a traceback about `NoneType`.

The key sets below say what "exactly the documented keys" means for each
block. A mapping is rejected for a missing key *and* for an unexpected one:
a typo that silently falls back to a default is the kind of bug that makes
a lab's numbers unreproducible.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import isfinite
from pathlib import Path

from app.errors import ScenarioError

ROOT_KEYS = frozenset(
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
UNIVERSE_KEYS = frozenset({"sectors", "names"})
NAME_KEYS = frozenset(
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
LIMIT_KEYS = frozenset(
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
MARKET_KEYS = frozenset(
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
FRONTIER_KEYS = frozenset({"points", "min_target_monthly", "max_target_monthly"})
ALGORITHM_KEYS = frozenset({"scenario_ladder", "objective_relative_tolerance"})
STUDY_KEYS = frozenset(
    {
        "seeds",
        "scenarios",
        "matched_target_monthly",
        "elliptical_weight_tolerance",
        "divergence_ratio_min",
    }
)
TOLERANCE_KEYS = frozenset(
    {
        "constraint_abs",
        "cvar_agreement_abs",
        "var_recovery_abs",
        "solver_agreement_rel",
        "relaxation_abs",
        "dual_relative",
    }
)


def as_mapping(value: object, path: str, keys: frozenset[str]) -> Mapping[str, object]:
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


def as_number(value: object, path: str) -> float:
    """Return a finite float, rejecting booleans, strings and NaN alike."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScenarioError(f"{path} must be a number, got {type(value).__name__}")
    result = float(value)
    if not isfinite(result):
        raise ScenarioError(f"{path} must be finite, got {value}")
    return result


def as_integer(value: object, path: str) -> int:
    """Return a whole number, rejecting booleans and fractional values."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScenarioError(f"{path} must be an integer, got {type(value).__name__}")
    return value


def as_text(value: object, path: str) -> str:
    """Return a non-empty string, rejecting numbers YAML happened to parse."""
    if not isinstance(value, str) or not value.strip():
        raise ScenarioError(f"{path} must be a non-empty string")
    return value.strip()


def as_sequence(value: object, path: str) -> Sequence[object]:
    """Return a YAML list, rejecting a bare scalar or a mapping."""
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ScenarioError(f"{path} must be a list, got {type(value).__name__}")
    return value


def as_text_tuple(value: object, path: str) -> tuple[str, ...]:
    """Return a list of strings with each element's index in its own path."""
    items = as_sequence(value, path)
    return tuple(as_text(item, f"{path}[{index}]") for index, item in enumerate(items))


def as_integer_tuple(value: object, path: str) -> tuple[int, ...]:
    """Return a list of integers with each element's index in its own path."""
    items = as_sequence(value, path)
    return tuple(
        as_integer(item, f"{path}[{index}]") for index, item in enumerate(items)
    )


def as_optional_path(value: object, path: str) -> Path | None:
    """Return a filesystem path, or `None` for the generated-market default."""
    if value is None:
        return None
    return Path(as_text(value, path))


def peek_field(raw: object, key: str, path: str) -> object:
    """Read one key out of a mapping before its exact key set is known.

    Name entries are addressed by the name they carry, so the loader has to
    read `name` before it can report any other problem in that entry under
    `universe.names.<name>.<field>`.
    """
    if not isinstance(raw, Mapping) or key not in raw:
        raise ScenarioError(f"{path} must be a mapping holding a {key!r} field")
    return raw[key]
