import importlib
import json
import sys
from pathlib import Path
from urllib.parse import quote

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PROFILE = json.dumps({"id": "cus_0001", "name": "Fake Customer"})
OBJECTS = {
    "public/readme.txt": b"readme",
    "public/welcome.txt": b"welcome",
    "private/customers/cus_0001/profile.json": PROFILE.encode(),
}


class FakeResp:
    def __init__(self, status=200, content=b"", payload=None):
        self.status_code = status
        self.content = content
        self._payload = payload

    def json(self):
        return self._payload


class FakeRequests:
    def __init__(self):
        self.gcs_calls = []
        self.fail = False

    def get(self, url, headers=None, params=None, timeout=None):
        if "/computeMetadata/v1/instance/service-accounts/default/token" in url:
            assert headers == {"Metadata-Flavor": "Google"}
            return FakeResp(payload={"access_token": "tok", "expires_in": 3599})
        assert headers["Authorization"] == "Bearer tok"
        prefix = "https://storage.googleapis.com/storage/v1/b/bkt/o"
        assert url.startswith(prefix)
        if self.fail:
            return FakeResp(500)
        if url == prefix:
            names = [n for n in OBJECTS if n.startswith(params["prefix"])]
            return FakeResp(payload={"items": [{"name": n} for n in names]})
        raw = url[len(prefix) + 1:]
        self.gcs_calls.append(raw)
        for name, body in OBJECTS.items():
            if raw == quote(name, safe=""):
                return FakeResp(200, body)
        return FakeResp(404)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("BUCKET", "bkt")
    monkeypatch.setenv("APP_ENV", "prod")
    fake = FakeRequests()
    sys.modules.pop("app", None)
    app = importlib.import_module("app")
    monkeypatch.setattr(app, "requests", fake)
    app.app.testing = True
    return app.app.test_client(), fake


def test_healthz_ok(env):
    client, fake = env
    r = client.get("/healthz")
    assert r.status_code == 200 and r.data == b"ok"
    assert fake.gcs_calls == []


def test_index_lists_public_and_shows_env(env):
    client, _ = env
    body = client.get("/").get_data(as_text=True)
    assert "prod" in body
    assert "public/readme.txt" in body


def test_files_returns_public_object(env):
    client, _ = env
    r = client.get("/files?name=readme.txt")
    assert r.status_code == 200 and r.data == b"readme"


def test_files_traversal_reaches_private(env):
    client, fake = env
    r = client.get("/files?name=../private/customers/cus_0001/profile.json")
    assert r.status_code == 200
    assert r.data == PROFILE.encode()
    assert fake.gcs_calls == [quote("private/customers/cus_0001/profile.json", safe="")]


def test_files_missing_object_is_404(env):
    client, _ = env
    assert client.get("/files?name=nope.txt").status_code == 404


def test_gcs_error_is_502_and_app_keeps_serving(env):
    client, fake = env
    fake.fail = True
    assert client.get("/files?name=readme.txt").status_code == 502
    assert client.get("/healthz").status_code == 200
