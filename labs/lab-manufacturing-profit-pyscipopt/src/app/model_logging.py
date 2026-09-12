"""Describe SCIP setup using installed domains and the submitted expressions."""

from __future__ import annotations

from pyscipopt import Expr, ExprCons, Model, Variable

from app.logging_setup import Logger


def format_expression(expression: Expr) -> str:
    """Render polynomial terms with SCIP names and round-trippable coefficients.

    Terms come directly from PySCIPOpt, including quadratic products. Zero terms
    are omitted; no business coefficients or equations are reconstructed here.
    """
    parts: list[str] = []
    for term, coefficient in expression.terms.items():
        value = float(coefficient)
        if value == 0:
            continue
        magnitude = repr(abs(value)).removesuffix(".0")
        product = " * ".join(str(variable.name) for variable in term.vartuple)
        body = f"{magnitude} * {product}" if product else magnitude
        sign = " - " if value < 0 else " + "
        parts.append(("-" if value < 0 else "") + body if not parts else sign + body)
    return "".join(parts) or "0"


def log_variable(variable: Variable, *, log: Logger) -> None:
    """Log a successfully created variable's actual SCIP type and original bounds.

    The caller invokes this after creation, before solving or presolve can change
    domains. Matrix callers emit one event per scalar, with SCIP's zero-based name.
    """
    log.info(
        "Creating variable succeeded.",
        name=str(variable.name),
        variable_type=str(variable.vtype()),
        lower_bound=float(variable.getLbOriginal()),
        upper_bound=float(variable.getUbOriginal()),
    )


def add_constraint(
    model: Model, expression: ExprCons, *, name: str, log: Logger
) -> None:
    """Install one named equation and log its polynomial and installed sides.

    Uses the exact expression submitted to SCIP, and reads bounds from the added
    constraint. Missing sides become JSON null. Failures propagate to the caller's
    equation-group boundary, with no success event for a rejected constraint.
    """
    log.info("Adding constraint...", name=name)
    try:
        constraint = model.addCons(expression, name=name)
        left, right = float(model.getLhs(constraint)), float(model.getRhs(constraint))
        lower = None if model.isInfinity(-left) else left
        upper = None if model.isInfinity(right) else right
        polynomial = format_expression(expression.expr)
        left_text = repr(left).removesuffix(".0")
        right_text = repr(right).removesuffix(".0")
        if lower == upper:
            equation = f"{polynomial} == {right_text}"
        elif lower is None:
            equation = f"{polynomial} <= {right_text}"
        elif upper is None:
            equation = f"{polynomial} >= {left_text}"
        else:
            equation = f"{left_text} <= {polynomial} <= {right_text}"
    except Exception:
        log.exception("Adding constraint failed.", name=name)
        raise
    else:
        log.info(
            "Adding constraint succeeded.",
            name=str(constraint.name),
            expression=equation,
            lower_bound=lower,
            upper_bound=upper,
        )
