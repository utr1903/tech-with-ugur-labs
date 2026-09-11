FROM python:3.12.14-slim-trixie@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/lab/src

# Debian login shells reset PATH in /etc/profile before loading profile.d.
RUN printf '%s\n' 'export PATH="/opt/venv/bin:$PATH"' \
    > /etc/profile.d/uv-venv.sh

RUN python -m pip install --no-cache-dir uv==0.12.13

WORKDIR /lab
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

CMD ["sleep", "infinity"]
