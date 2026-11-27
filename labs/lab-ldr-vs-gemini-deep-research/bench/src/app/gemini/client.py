"""Settings for the Gemini agent and the adapter over the google-genai SDK."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from importlib.metadata import version

from google import genai
from google.genai import errors, types
from google.genai._interactions_errors import GeminiNextGenAPIClientError

from app.envvars import number_from_env
from app.errors import ConfigError, GeminiError

DEFAULT_AGENT = "deep-research-preview-04-2026"
DEFAULT_API_VERSION = "v1beta"
# Per HTTP request, in milliseconds: a hung call fails instead of stalling a
# multi-hour batch. Polling re-asks every few seconds, so this is generous.
REQUEST_TIMEOUT_MS = 120_000


@dataclass(frozen=True)
class GeminiSettings:
    """Which agent to call, with what key, and how long to wait for it."""

    api_key: str
    agent: str
    api_version: str
    poll_seconds: float
    timeout_seconds: float


def gemini_settings_from_env(env: Mapping[str, str]) -> GeminiSettings:
    """Reads the Gemini settings; only the API key has no default."""
    api_key = env.get("GEMINI_API_KEY", "")
    if not api_key:
        raise ConfigError(
            "GEMINI_API_KEY is not set; the committed Gemini runs under "
            "results/runs/gemini can still be scored with make score"
        )
    return GeminiSettings(
        api_key=api_key,
        agent=env.get("GEMINI_AGENT") or DEFAULT_AGENT,
        api_version=env.get("GEMINI_API_VERSION") or DEFAULT_API_VERSION,
        poll_seconds=number_from_env(env, "GEMINI_POLL_SECONDS", 15.0),
        timeout_seconds=number_from_env(env, "GEMINI_TIMEOUT_MINUTES", 65.0) * 60,
    )


def sdk_version() -> str:
    """The installed google-genai version, recorded with every run."""
    return version("google-genai")


class GenaiInteractions:
    """The lab's `InteractionsApi` over the SDK; SDK failures become `GeminiError`."""

    def __init__(self, settings: GeminiSettings) -> None:
        # Keep the client itself: it closes its HTTP session when garbage
        # collected, which breaks every later `interactions` call.
        self._client = genai.Client(
            api_key=settings.api_key,
            http_options=types.HttpOptions(
                api_version=settings.api_version,
                timeout=REQUEST_TIMEOUT_MS,
            ),
        )
        self._interactions = self._client.interactions

    def create(self, *, agent: str, prompt: str, background: bool) -> object:
        """Starts a background interaction."""
        try:
            return self._interactions.create(
                agent=agent, input=prompt, background=background
            )
        except _SDK_ERRORS as err:
            raise GeminiError(f"creating the interaction failed: {err}") from err

    def get(self, interaction_id: str, /) -> object:
        """Fetches the interaction's current state."""
        try:
            return self._interactions.get(interaction_id)
        except _SDK_ERRORS as err:
            raise GeminiError(f"fetching the interaction failed: {err}") from err

    def cancel(self, interaction_id: str, /) -> object:
        """Asks the service to stop the interaction."""
        try:
            return self._interactions.cancel(interaction_id)
        except _SDK_ERRORS as err:
            raise GeminiError(f"cancelling the interaction failed: {err}") from err


_SDK_ERRORS = (errors.APIError, GeminiNextGenAPIClientError)
