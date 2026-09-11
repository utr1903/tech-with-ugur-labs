"""Exact top-level and section schemas for the scenario YAML."""

from __future__ import annotations

from dataclasses import dataclass

from app.contracts import Axes
from app.scenario.parsing import Node, require_keys

_TOP_LEVEL_KEYS = (
    "assumptions",
    "solver",
    "staff",
    "support",
    "regional_budget_musd",
    "office_overhead_musd",
    "investments",
    "central_allowance_musd",
    "research",
    "knowledge",
    "factories",
    "materials",
    "electricity",
    "shipping_cost_musd_per_unit",
    "market",
)


@dataclass(frozen=True)
class ScenarioSections:
    """Validated named mappings used by focused numeric converters."""

    root: Node
    staff: Node
    support: Node
    investments: Node
    research_regions: Node
    knowledge: Node
    factories: Node
    materials: Node
    electricity: Node
    market: Node


def _validate_staff(data: Node, axes: Axes) -> Node:
    staff = require_keys(data["staff"], axes.regions, "scenario.staff")
    fields = ("minimum", "maximum", "salary_musd_per_person")
    for region in axes.regions:
        teams = require_keys(staff[region], axes.teams, f"scenario.staff.{region}")
        for team in axes.teams:
            require_keys(teams[team], fields, f"scenario.staff.{region}.{team}")
    return staff


def _validate_research(data: Node) -> Node:
    regions = ("us", "india")
    research = require_keys(data["research"], ("regions",), "scenario.research")
    values = require_keys(research["regions"], regions, "scenario.research.regions")
    for region in regions:
        require_keys(
            values[region],
            ("alpha", "beta", "upgrade_alpha_gain"),
            f"scenario.research.regions.{region}",
        )
    return values


def parse_sections(raw: object, axes: Axes) -> ScenarioSections:
    """Reject missing and extra YAML sections before numeric conversion."""
    data = require_keys(raw, _TOP_LEVEL_KEYS, "scenario")
    require_keys(
        data["assumptions"],
        ("company_statement", "money_units", "volume_units"),
        "scenario.assumptions",
    )
    support = require_keys(
        data["support"], ("fixed_headcount", "coverage_ratios"), "scenario.support"
    )
    investments = require_keys(
        data["investments"], axes.investments, "scenario.investments"
    )
    for investment in axes.investments:
        require_keys(
            investments[investment],
            ("cost_musd",),
            f"scenario.investments.{investment}",
        )
    knowledge = require_keys(
        data["knowledge"],
        (
            "process_conversion",
            "initial_process_saving",
            "max_process_saving",
            "material_saving_floor",
            "initial_development_stock",
            "max_development_stock",
            "development_threshold",
            "maintenance_required",
        ),
        "scenario.knowledge",
    )
    factories = require_keys(
        data["factories"],
        (
            "capacity",
            "germany_capacity_gain",
            "manufacturing_productivity",
            "manufacturing_effort",
            "overhead_musd",
        ),
        "scenario.factories",
    )
    materials = require_keys(
        data["materials"],
        ("requirement_per_unit", "price_musd_per_material"),
        "scenario.materials",
    )
    electricity = require_keys(
        data["electricity"], ("baseline", "per_unit", "tariffs"), "scenario.electricity"
    )
    market = require_keys(
        data["market"],
        (
            "demand_base",
            "reference_price_musd_per_unit",
            "price_min_musd_per_unit",
            "price_max_musd_per_unit",
            "price_sensitivity",
            "sales_alpha",
            "sales_beta",
        ),
        "scenario.market",
    )
    return ScenarioSections(
        root=data,
        staff=_validate_staff(data, axes),
        support=support,
        investments=investments,
        research_regions=_validate_research(data),
        knowledge=knowledge,
        factories=factories,
        materials=materials,
        electricity=electricity,
        market=market,
    )
