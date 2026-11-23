"""Reads the attacker pod's sink log and a scenario pod's IP from the cluster."""

from __future__ import annotations

from app.errors import KubeError
from app.kube.kubectl import kubectl
from app.logging_setup import Logger

ATTACKER_NAMESPACE = "attacker"
ATTACKER_POD = "attacker"
# Only recent lines matter: a run's check happens seconds after its marker.
LOG_SINCE = "10m"


def _require_ip(ip: str, namespace: str, pod: str) -> str:
    if not ip:
        raise KubeError(f"pod {namespace}/{pod} has no IP")
    return ip


def pod_ip(namespace: str, pod: str, *, log: Logger) -> str:
    """The pod's IP, as the attacker sinks log it in `peer`."""
    try:
        log.info("Reading pod IP...", namespace=namespace, pod=pod)
        raw = kubectl(
            ["get", "pod", "-n", namespace, pod, "-o", "jsonpath={.status.podIP}"],
            log=log,
        ).stdout.strip()
        ip = _require_ip(raw, namespace, pod)
    except Exception:
        log.exception("Reading pod IP failed.", namespace=namespace, pod=pod)
        raise
    else:
        log.info("Reading pod IP succeeded.", pod=pod, ip=ip)
        return ip


def attacker_log(*, log: Logger) -> str:
    """The attacker pod's recent stdout: one JSON line per sink connection."""
    try:
        log.info("Reading attacker log...")
        text = kubectl(
            [
                "logs",
                "-n",
                ATTACKER_NAMESPACE,
                ATTACKER_POD,
                f"--since={LOG_SINCE}",
            ],
            log=log,
        ).stdout
    except Exception:
        log.exception("Reading attacker log failed.")
        raise
    else:
        log.info("Reading attacker log succeeded.", lines=len(text.splitlines()))
        return text
