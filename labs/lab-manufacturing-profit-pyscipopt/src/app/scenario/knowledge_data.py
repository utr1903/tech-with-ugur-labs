"""Conversion of R&D output and cumulative knowledge coefficients."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.contracts import Axes, FloatArray
from app.scenario.parsing import number, require_keys, tensor
from app.scenario.sections import ScenarioSections

_RD_REGIONS = ("us", "india")
_RD_FIELDS = ("alpha", "beta", "upgrade_alpha_gain")


@dataclass(frozen=True)
class KnowledgeData:
    """Immutable R&D and knowledge coefficients."""

    rd_alpha: FloatArray
    rd_beta: FloatArray
    rd_upgrade_alpha_gain: FloatArray
    process_conversion: FloatArray
    initial_process_saving: float
    max_process_saving: float
    material_saving_floor: float
    initial_development_stock: float
    max_development_stock: float
    development_threshold: float
    maintenance_required: FloatArray


def _research_array(
    sections: ScenarioSections,
    field: str,
    years: tuple[str, ...],
) -> FloatArray:
    values: list[object] = []
    for region in _RD_REGIONS:
        path = f"scenario.research.regions.{region}"
        node = require_keys(sections.research_regions[region], _RD_FIELDS, path)
        values.append(node[field])
    if years:
        rows = []
        for region, value in zip(_RD_REGIONS, values, strict=True):
            path = f"scenario.research.regions.{region}.{field}"
            named = require_keys(value, years, path)
            rows.append([number(named[year], f"{path}.{year}") for year in years])
        result = np.array(rows, dtype=np.float64, copy=True)
        result.flags.writeable = False
        return result
    result = np.array(
        [
            number(value, f"scenario.research.regions.{region}.{field}")
            for region, value in zip(_RD_REGIONS, values, strict=True)
        ],
        dtype=np.float64,
        copy=True,
    )
    result.flags.writeable = False
    return result


def _knowledge_number(sections: ScenarioSections, name: str) -> float:
    return number(sections.knowledge[name], f"scenario.knowledge.{name}")


def convert_knowledge(sections: ScenarioSections, axes: Axes) -> KnowledgeData:
    """Convert research and knowledge mappings in canonical axis order."""
    years = tuple(f"year_{year}" for year in axes.years)
    return KnowledgeData(
        rd_alpha=_research_array(sections, "alpha", years),
        rd_beta=_research_array(sections, "beta", years),
        rd_upgrade_alpha_gain=_research_array(sections, "upgrade_alpha_gain", ()),
        process_conversion=tensor(
            sections.knowledge["process_conversion"],
            "scenario.knowledge.process_conversion",
            (years,),
        ),
        initial_process_saving=_knowledge_number(sections, "initial_process_saving"),
        max_process_saving=_knowledge_number(sections, "max_process_saving"),
        material_saving_floor=_knowledge_number(sections, "material_saving_floor"),
        initial_development_stock=_knowledge_number(
            sections, "initial_development_stock"
        ),
        max_development_stock=_knowledge_number(sections, "max_development_stock"),
        development_threshold=_knowledge_number(sections, "development_threshold"),
        maintenance_required=tensor(
            sections.knowledge["maintenance_required"],
            "scenario.knowledge.maintenance_required",
            (years,),
        ),
    )
