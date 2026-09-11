FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.16 /uv /uvx /bin/

WORKDIR /app

# The dev group ships in the image on purpose: the lock is Linux-only, so
# ruff, mypy and pytest can only run in here.
COPY pyproject.toml uv.lock ./
COPY src/ src/
RUN uv sync --locked

COPY . .

ENV PATH="/app/.venv/bin:$PATH"
CMD ["app", "run"]
