"""Renders a service's config, a lockfile and the advisories document."""

from __future__ import annotations

import json
import random

import yaml

from app.fixtures.catalog import PACKAGES, AdvisorySpec
from app.fixtures.plan_types import ServicePlan


def _tls_version(rng: random.Random, risky: bool) -> str:
    return rng.choice(("1.0", "1.1") if risky else ("1.2", "1.3"))


def render_config(plan: ServicePlan, rng: random.Random) -> bytes:
    """A config whose risky settings are exactly the planted flags."""
    flags = set(plan.flags)
    origins = ["https://app.example.test", f"https://{plan.name}.example.test"]
    if "cors_wildcard" in flags:
        origins.append("*")
    config = {
        "service": plan.name,
        "workers": rng.randint(2, 8),
        # A decoy: the word "debug" as a value is not the debug flag.
        "log_level": rng.choice(("info", "debug", "warning")),
        "debug": "debug" in flags,
        "tls": {"min_version": _tls_version(rng, "tls_min_version" in flags)},
        "cors": {"allow_origins": origins},
        "admin": {
            "bind": "0.0.0.0" if "admin_public" in flags else "127.0.0.1",
            "port": 9000,
        },
        "auth": {"enabled": "auth_disabled" not in flags, "session_minutes": 30},
    }
    return yaml.safe_dump(config, sort_keys=True).encode()


def render_lock(plan: ServicePlan) -> bytes:
    """`name==version` pins, with a comment header."""
    lines = [f"# Pinned dependencies for {plan.name}"]
    lines += [f"{PACKAGES[name].display}=={version}" for name, version in plan.packages]
    return ("\n".join(lines) + "\n").encode()


def render_advisories(advisories: tuple[AdvisorySpec, ...]) -> bytes:
    """advisories.json for the fleet."""
    document = {
        "advisories": [
            {
                "id": a.id,
                "package": a.package,
                "summary": a.summary,
                "affected": [{"introduced": a.introduced, "fixed": a.fixed}],
            }
            for a in advisories
        ]
    }
    return (json.dumps(document, indent=2, sort_keys=True) + "\n").encode()
