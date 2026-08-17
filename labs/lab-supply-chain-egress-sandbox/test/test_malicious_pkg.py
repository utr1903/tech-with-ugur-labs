import importlib.util
import os

HERE = os.path.dirname(__file__)
PKG = os.path.join(HERE, "..", "malicious-pkg")


def _load_setup():
    # Import malicious-pkg/setup.py as a module WITHOUT running setup():
    # the exfil helpers are module-level and side-effect-free to import.
    path = os.path.join(PKG, "setup.py")
    spec = importlib.util.spec_from_file_location("demo_setup", path)
    mod = importlib.util.module_from_spec(spec)
    os.environ.setdefault("_DEMO_IMPORT_ONLY", "1")  # setup.py guards on this
    spec.loader.exec_module(mod)
    return mod


def test_sink_is_a_hardcoded_local_host():
    mod = _load_setup()
    assert mod.SINK_URL == "http://attacker:9000/collect"


def test_collect_creds_reads_only_named_fake_vars():
    mod = _load_setup()
    env = {
        "AWS_ACCESS_KEY_ID": "AKIAFAKE000LABONLY",
        "AWS_SECRET_ACCESS_KEY": "FAKE-lab-only-not-a-real-secret",
        "HOME": "/root",           # must be ignored
        "PATH": "/usr/bin",        # must be ignored
    }
    creds = mod.collect_creds(env)
    assert creds == {
        "AWS_ACCESS_KEY_ID": "AKIAFAKE000LABONLY",
        "AWS_SECRET_ACCESS_KEY": "FAKE-lab-only-not-a-real-secret",
    }


def test_build_payload_is_none_without_creds():
    mod = _load_setup()
    assert mod.build_payload({}) is None


def test_build_payload_tags_the_run():
    mod = _load_setup()
    payload = mod.build_payload(
        {"LAB_API_TOKEN": "lab-token-FAKE-000", "EXFIL_TAG": "host-install"}
    )
    assert payload["tag"] == "host-install"
    assert payload["creds"] == {"LAB_API_TOKEN": "lab-token-FAKE-000"}
    assert payload["source"] == "friendly-setup"


def test_benign_module_greets():
    spec = importlib.util.spec_from_file_location(
        "friendly", os.path.join(PKG, "friendly", "__init__.py")
    )
    friendly = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(friendly)
    assert friendly.greet("reader") == "Hello, reader!"
