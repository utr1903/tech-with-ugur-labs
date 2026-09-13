"""FastAPI app with exactly two routes: GET /capabilities and POST /execute."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.admission import ExecutionSlots
from app.api.request_parsing import InvalidRequestError, parse_execute_body
from app.api.serialization import outcome_to_json
from app.capabilities.report import Capabilities, capabilities_to_json
from app.config import Settings
from app.execution.models import ExecutionOutcome
from app.execution.runner import run_code
from app.logging_setup import Logger

# JSON-escaping a code string can at most quadruple its byte length (every
# byte becoming a `\u00XX` escape); the extra 1024 covers the `{"code": ...}`
# envelope. A declared Content-Length above this is rejected before the body
# is even read.
_CONTENT_LENGTH_HEADROOM_BYTES = 1024


def _invalid_request(message: str) -> JSONResponse:
    return JSONResponse(
        {"error": "invalid_request", "message": message}, status_code=400
    )


def _outcome_response(outcome: ExecutionOutcome, *, log: Logger) -> JSONResponse:
    """Builds the 200 response for a finished execution.

    A result.json that is valid JSON but nested so deeply that encoding the
    HTTP response overflows Python's recursion guard must still come back
    as 200: the code executed successfully, only its structured result
    could not be carried over the wire.
    """
    try:
        return JSONResponse(outcome_to_json(outcome))
    except RecursionError:
        log.warning("Execute outcome's result was too deeply nested to serialize.")
        body = outcome_to_json(outcome)
        body["result"] = None
        body["resultError"] = "result.json is nested too deeply to return"
        return JSONResponse(body)


def _declared_length_too_large(request: Request, *, max_content_length: int) -> bool:
    """True if the request announces a body larger than allowed.

    A missing or unparsable header is not treated as oversized here: the
    body-size check after reading still catches an actually-oversized
    request, and a malformed header is not this check's job to diagnose.
    """
    declared = request.headers.get("content-length")
    if declared is None:
        return False
    try:
        return int(declared) > max_content_length
    except ValueError:
        return False


def create_app(
    *, settings: Settings, capabilities: Capabilities, runs_root: Path, log: Logger
) -> FastAPI:
    """Wires routes to the runner. The result of an execution only ever
    travels back on the request that submitted it."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    slots = ExecutionSlots(capacity=settings.max_concurrent_executions)
    capabilities_body = capabilities_to_json(capabilities)
    max_content_length = 4 * settings.max_code_bytes + _CONTENT_LENGTH_HEADROOM_BYTES

    @app.get("/capabilities")
    async def get_capabilities() -> JSONResponse:
        return JSONResponse(capabilities_body)

    @app.post("/execute")
    async def execute(request: Request) -> JSONResponse:
        if _declared_length_too_large(request, max_content_length=max_content_length):
            log.warning(
                "Rejecting execute request: declared body too large.",
                declared_length=request.headers.get("content-length"),
            )
            return _invalid_request(
                f"request body must declare at most {max_content_length} bytes"
            )
        try:
            code = parse_execute_body(
                await request.body(), max_code_bytes=settings.max_code_bytes
            )
        except InvalidRequestError as err:
            log.warning("Rejecting execute request.", reason=str(err))
            return _invalid_request(str(err))
        if not slots.try_acquire():
            log.warning(
                "Refusing execute request: all slots busy.", in_use=slots.in_use
            )
            return JSONResponse(
                {
                    "error": "sandbox_busy",
                    "message": "all execution slots are in use; retry shortly",
                },
                status_code=429,
                headers={"Retry-After": "1"},
            )
        try:
            outcome = await run_code(
                code, settings=settings, runs_root=runs_root, log=log
            )
        finally:
            slots.release()
        return _outcome_response(outcome, log=log)

    return app
