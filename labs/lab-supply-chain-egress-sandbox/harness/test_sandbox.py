"""Assert the three lab outcomes from the shared evidence volume."""

import json
import os

ATTACKER = "/evidence/attacker.log"
PROXY = "/evidence/proxy.log"


def _read(path):
    assert os.path.exists(path), f"missing evidence file: {path}"
    with open(path) as fh:
        return fh.read()


def _install(label):
    path = f"/evidence/{label}_install.json"
    assert os.path.exists(path), f"missing install record: {path}"
    with open(path) as fh:
        return json.load(fh)


def test_unsafe_install_leaked_credentials():
    log = _read(ATTACKER)
    assert "host-install" in log, "no exfil tagged host-install reached the sink"
    assert "AKIAFAKE000LABONLY" in log
    assert "FAKE-lab-only-not-a-real-secret" in log


def test_safe_exfil_was_blocked_and_attributed():
    log = _read(PROXY)
    denies = [ln for ln in log.splitlines() if ln.startswith("DENY")]
    assert denies, "proxy recorded no DENY"
    assert any("host=attacker" in ln for ln in denies), "exfil host not attributed"


def test_safe_exfil_never_reached_the_sink():
    log = _read(ATTACKER)
    assert "sandboxed-install" not in log, "sandboxed exfil should never arrive"


def test_both_installs_succeeded_and_package_is_usable():
    unsafe = _install("host-install")
    safe = _install("sandboxed-install")
    for rec in (unsafe, safe):
        assert rec["pip_rc"] == 0, f"pip failed: {rec}"
        assert rec["import_ok"] is True, f"import failed: {rec}"
        assert rec["greeting"] == "Hello, reader!"


def test_proxy_allowed_the_package_source():
    log = _read(PROXY)
    allows = [ln for ln in log.splitlines() if ln.startswith("ALLOW")]
    assert any("host=mirror" in ln for ln in allows), "package fetch was not allowed"
