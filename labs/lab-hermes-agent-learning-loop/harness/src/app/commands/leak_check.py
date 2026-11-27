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
    report = settings.results_dir / "leak-check.txt"
    if not settings.results_dir.is_dir():
        raise LeakError(f"Results directory {settings.results_dir} does not exist")
    # Replace any earlier verdict first so a failure can never leave a stale pass.
    _write(report, ["exit=1", "hits=0", "error=scan did not finish"])
    try:
        hits = _scan_all(settings, log=log)
    except LeakError as err:
        _write(report, ["exit=1", "hits=0", f"error={_safe(str(err))}"])
        raise
    lines = [f"exit={int(bool(hits))}", f"hits={len(hits)}"]
    lines.extend(f"{hit.kind} {_safe(str(hit.path))}" for hit in hits)
    _write(report, lines)
    for hit in hits:
        log.error("Credential material found.", kind=hit.kind, path=str(hit.path))
    if hits:
        raise LeakError(f"{len(hits)} credential hit(s); see {report}")
    log.info("No credential material found.", report=str(report))
    write_line("leak-check: clean")


def _scan_all(settings: Settings, *, log: Logger) -> list[LeakHit]:
    secrets: tuple[str, ...] = ()
    if settings.leak_check_adc:
        secrets = secrets_from_adc(settings.adc_file)
    else:
        log.warning("LEAK_CHECK_ADC=off: not scanning for ADC secrets.")
    if not settings.vertex_project_id:
        log.warning("VERTEX_PROJECT_ID is not set: not scanning for the project id.")
    hits: list[LeakHit] = []
    for root in (settings.results_dir, settings.out_dir):
        found = scan(
            root,
            secrets,
            api_key=settings.api_key,
            project_id=settings.vertex_project_id,
        )
        hits.extend(LeakHit(Path(root.name) / hit.path, hit.kind) for hit in found)
    return hits


def _write(report: Path, lines: list[str]) -> None:
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _safe(text: str) -> str:
    """Escapes non-ASCII and control characters so one hit stays on one line."""
    return ascii(text)[1:-1]
