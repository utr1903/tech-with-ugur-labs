FROM python:3.12.14-slim-trixie@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/lab/src \
    MPLBACKEND=Agg

# Debian login shells reset PATH in /etc/profile before loading profile.d.
RUN printf '%s\n' 'export PATH="/opt/venv/bin:$PATH"' \
    > /etc/profile.d/uv-venv.sh

RUN python -m pip install --no-cache-dir uv==0.12.17

WORKDIR /lab
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

CMD ["sleep", "infinity"]
