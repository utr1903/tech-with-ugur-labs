"""The `leak-check` command: no credential material in results/ or out/."""

from __future__ import annotations

from pathlib import Path

from app.envvars import Settings
from app.errors import LeakError
from app.leaks.scan import LeakHit, scan, secrets_from_adc
from app.logging_setup import Logger
from app.output import write_line


def run(settings: Settings, *, log: Logger) -> None:
    """Scans results and out; writes results/leak-check.txt; raises on hits."""
    secrets = secrets_from_adc(settings.adc_file)
    hits: list[LeakHit] = []
    for root in (settings.results_dir, settings.out_dir):
        found = scan(root, secrets, api_key=settings.api_key)
        hits.extend(LeakHit(Path(root.name) / hit.path, hit.kind) for hit in found)
    lines = [f"exit={int(bool(hits))}", f"hits={len(hits)}"]
    lines.extend(f"{hit.kind} {hit.path}" for hit in hits)
    report = settings.results_dir / "leak-check.txt"
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for hit in hits:
        log.error("Credential material found.", kind=hit.kind, path=str(hit.path))
    if hits:
        raise LeakError(f"{len(hits)} credential hit(s); see {report}")
    log.info("No credential material found.", report=str(report))
    write_line("leak-check: clean")
