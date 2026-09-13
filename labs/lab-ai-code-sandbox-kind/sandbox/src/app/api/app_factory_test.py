from __future__ import annotations

import asyncio
import time

import httpx


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
    # settings' 65536-byte default max_code_bytes.
    body = b'{"code": "' + b"a" * (1024 * 1024) + b'"}'
    response = await client.post(
        "/execute", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


async def test_a_deeply_nested_but_valid_result_never_crashes_the_response(
    client: httpx.AsyncClient,
) -> None:
    # This depth of `[[[...1...]]]` parses cleanly (it is well inside what
    # `json.loads` accepts) but, empirically, sits deep enough that encoding
    # the HTTP response from inside the ASGI/Starlette call stack overflows
    # Python's recursion guard. An executed submission must still come back
    # as 200 with the documented shape, never an unhandled RecursionError.
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
