"""Assembly of focused numeric sections into the public scenario contract."""

from __future__ import annotations

from app.contracts import Axes, Scenario
from app.scenario.knowledge_data import convert_knowledge
from app.scenario.market_data import convert_market
from app.scenario.operations_data import convert_operations
from app.scenario.sections import parse_sections
from app.scenario.workforce_data import convert_workforce


def construct_scenario(raw: object) -> Scenario:
    """Convert an exact named YAML schema into immutable numeric data."""
    axes = Axes()
    sections = parse_sections(raw, axes)
    workforce = convert_workforce(sections, axes)
    knowledge = convert_knowledge(sections, axes)
    operations = convert_operations(sections, axes)
    market = convert_market(sections, axes)
    return Scenario(
        axes=axes,
        solver=workforce.solver,
        staff_min=workforce.staff_min,
        staff_max=workforce.staff_max,
        salary=workforce.salary,
        support_fixed=workforce.support_fixed,
        support_ratios=workforce.support_ratios,
        regional_budget=workforce.regional_budget,
        office_overhead=workforce.office_overhead,
        investment_cost=workforce.investment_cost,
        central_allowance=workforce.central_allowance,
        rd_alpha=knowledge.rd_alpha,
        rd_beta=knowledge.rd_beta,
        rd_upgrade_alpha_gain=knowledge.rd_upgrade_alpha_gain,
        process_conversion=knowledge.process_conversion,
        initial_process_saving=knowledge.initial_process_saving,
        max_process_saving=knowledge.max_process_saving,
        material_saving_floor=knowledge.material_saving_floor,
        initial_development_stock=knowledge.initial_development_stock,
        max_development_stock=knowledge.max_development_stock,
        development_threshold=knowledge.development_threshold,
        maintenance_required=knowledge.maintenance_required,
        factory_capacity=operations.factory_capacity,
        germany_capacity_gain=operations.germany_capacity_gain,
        manufacturing_productivity=operations.manufacturing_productivity,
        manufacturing_effort=operations.manufacturing_effort,
        material_requirement=operations.material_requirement,
        material_price=operations.material_price,
        factory_baseline_electricity=operations.factory_baseline_electricity,
        electricity_per_unit=operations.electricity_per_unit,
        factory_overhead=operations.factory_overhead,
        tariff=operations.tariff,
        shipping_cost=operations.shipping_cost,
        demand_base=market.demand_base,
        reference_price=market.reference_price,
        price_min=market.price_min,
        price_max=market.price_max,
        price_sensitivity=market.price_sensitivity,
        sales_alpha=market.sales_alpha,
        sales_beta=market.sales_beta,
    )
