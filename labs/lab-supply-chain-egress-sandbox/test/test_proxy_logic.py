import importlib.util
import os

HERE = os.path.dirname(__file__)
PROXY = os.path.join(HERE, "..", "proxy", "proxy.py")


def _load_proxy():
    spec = importlib.util.spec_from_file_location("demo_proxy", PROXY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_parse_target_extracts_host_port_path():
    mod = _load_proxy()
    assert mod.parse_target("http://mirror:8000/friendly-1.0.0.tar.gz") == (
        "mirror",
        8000,
        "/friendly-1.0.0.tar.gz",
    )


def test_parse_target_defaults_port_and_path():
    mod = _load_proxy()
    assert mod.parse_target("http://attacker/collect") == ("attacker", 80, "/collect")
    assert mod.parse_target("http://attacker:9000") == ("attacker", 9000, "/")


def test_is_allowed_honours_the_list():
    mod = _load_proxy()
    allow = {"mirror"}
    assert mod.is_allowed("mirror", allow) is True
    assert mod.is_allowed("attacker", allow) is False
