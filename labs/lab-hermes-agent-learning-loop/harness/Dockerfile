FROM python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b AS base

COPY --from=ghcr.io/astral-sh/uv:0.13.10@sha256:a3ea1357342c1a4bf9a0c53a3deb1b55379aefa037338d8113d5771efa01774f /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY src/ src/

FROM base AS test

# The dev group is installed here so the checks run in a known environment.
RUN uv sync --locked
RUN uv run pytest \
    && uv run ruff check \
    && uv run ruff format --check \
    && uv run mypy \
    && uv run deptry src

FROM base AS runtime

RUN uv sync --locked --no-dev \
    && useradd --create-home --uid 10001 harness

ENV PATH="/app/.venv/bin:$PATH"
USER harness
ENTRYPOINT ["app"]
