from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest
from fastapi.responses import JSONResponse


async def test_capabilities_route(client: httpx.AsyncClient) -> None:
    response = await client.get("/capabilities")
    assert response.status_code == 200
    assert [m["importName"] for m in response.json()["modules"]][0] == "numpy"


async def test_execute_returns_the_outcome_in_camel_case(
    client: httpx.AsyncClient,
) -> None:
    code = "import json; print('hi'); json.dump([1], open('result.json', 'w'))"
    response = await client.post("/execute", json={"code": code})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "status",
        "exitCode",
        "stdout",
        "stderr",
        "result",
        "resultError",
        "durationMs",
        "truncated",
    }
    assert (body["status"], body["exitCode"], body["stdout"], body["result"]) == (
        "succeeded",
        0,
        "hi\n",
        [1],
    )


async def test_malformed_input_is_400(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/execute", content=b"nope", headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


async def test_full_gate_is_an_immediate_429_and_frees_afterwards(
    client: httpx.AsyncClient,
) -> None:
    slow = asyncio.create_task(
        client.post("/execute", json={"code": "import time; time.sleep(1.5)"})
    )
    await asyncio.sleep(0.5)
    started = time.monotonic()
    busy = await client.post("/execute", json={"code": "print(1)"})
    assert busy.status_code == 429
    assert busy.headers["retry-after"] == "1"
    assert time.monotonic() - started < 0.3
    assert (await slow).status_code == 200
    assert (await client.post("/execute", json={"code": "print(1)"})).status_code == 200


async def test_only_two_routes_exist(client: httpx.AsyncClient) -> None:
    for path in ("/docs", "/openapi.json", "/redoc", "/healthz"):
        assert (await client.get(path)).status_code == 404


async def test_declared_content_length_over_the_limit_is_400_without_reading_the_body(
    client: httpx.AsyncClient,
) -> None:
    # 1 MiB body: comfortably over `4 * max_code_bytes + 1024` for the test
    # settings' 65536-byte default max_code_bytes. Asserting the pre-check's
    # own message text (not just the shared "invalid_request" shape) matters
    # here: a 1 MiB code string is *also* rejected by the post-parse byte
    # check in request_parsing.py, which returns the same error shape with
    # a different message, so a bare status/error-code assertion would stay
    # green even if the Content-Length pre-check were deleted.
    body = b'{"code": "' + b"a" * (1024 * 1024) + b'"}'
    response = await client.post(
        "/execute", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["error"] == "invalid_request"
    assert "request body must declare" in payload["message"]


async def test_declared_content_length_over_the_limit_even_with_short_code(
    client: httpx.AsyncClient,
) -> None:
    # JSON must escape every control character as a 6-byte `\u00XX`
    # sequence, so 50,000 NUL bytes of *code* -- comfortably under the
    # 65536-byte max_code_bytes limit -- still produce a request body well
    # over `4 * max_code_bytes + 1024`. Only the Content-Length pre-check
    # can catch this: the post-parse byte check sees a decoded code string
    # that is well within the limit, so it would let this one through.
    code = "\x00" * 50_000
    body = json.dumps({"code": code}).encode("utf-8")
    assert len(code.encode("utf-8")) <= 65536
    assert len(body) > 4 * 65536 + 1024
    response = await client.post(
        "/execute", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["error"] == "invalid_request"
    assert "request body must declare" in payload["message"]


async def test_response_falls_back_when_serializing_the_outcome_recurses(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deterministic guard for `_outcome_response`'s fallback branch.

    Forces the exact failure `_outcome_response` is written to survive --
    building the response's `JSONResponse` raises `RecursionError` -- by
    making the *first* `JSONResponse(...)` call raise it and letting the
    fallback's second call go through untouched. This does not depend on
    finding a nesting depth that happens to overflow the recursion guard
    under whatever stack the test happens to run on (see the depth-based
    test below, which is a best-effort secondary check only, not proof).
    """
    real_json_response = JSONResponse
    calls = 0

    def flaky_json_response(content: dict[str, object]) -> JSONResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RecursionError("forced for test")
        return real_json_response(content)

    monkeypatch.setattr("app.api.app_factory.JSONResponse", flaky_json_response)

    code = "import json; print('hi'); json.dump([1], open('result.json', 'w'))"
    response = await client.post("/execute", json={"code": code})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["exitCode"] == 0
    assert body["stdout"] == "hi\n"
    assert body["stderr"] == ""
    assert body["truncated"] is False
    assert isinstance(body["durationMs"], int)
    assert body["result"] is None
    assert isinstance(body["resultError"], str) and body["resultError"]
    assert calls == 2


async def test_a_deeply_nested_but_valid_result_never_crashes_the_response(
    client: httpx.AsyncClient,
) -> None:
    # Best-effort secondary check only, not a substitute for the
    # deterministic test above: this depth of `[[[...1...]]]` parses
    # cleanly (it is well inside what `json.loads` accepts) and,
    # empirically, on this project's pinned pytest/httpx/FastAPI stack,
    # sits deep enough that encoding the HTTP response from inside the
    # ASGI/Starlette call stack overflows Python's recursion guard. The
    # exact depth that triggers it is sensitive to how many stack frames
    # the surrounding harness has already used, so a future dependency
    # bump could make this specific depth stop reproducing the crash --
    # the assertions below accept that by allowing either outcome, and
    # the guarantee this task cares about (never an unhandled
    # RecursionError, always 200) is proven unconditionally by the test
    # above instead.
    depth = 9975
    code = (
        "with open('result.json', 'w') as f:\n"
        f"    f.write('[' * {depth} + '1' + ']' * {depth})\n"
    )
    response = await client.post("/execute", json={"code": code})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    if body["result"] is None:
        assert isinstance(body["resultError"], str) and body["resultError"]
    else:
        assert body["result"] == [1]
