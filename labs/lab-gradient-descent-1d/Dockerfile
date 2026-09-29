FROM python:3.12.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.3 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev
CMD ["uv", "run", "--no-sync", "app"]
