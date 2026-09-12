ARG PYTHON_IMAGE=python:3.12.12-slim-bookworm@sha256:228390eced221ad2986a3dd77e10b1accca6ba8ceb36f1572de1b346a337cc1a
FROM ${PYTHON_IMAGE}
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt && rm /tmp/requirements.txt
COPY dist/*.whl /tmp/
RUN pip install --no-cache-dir --no-deps /tmp/*.whl && rm /tmp/*.whl && mkdir /work && chown 65532:65532 /work
USER 65532:65532
WORKDIR /work
ENTRYPOINT ["python", "-I", "-B", "-m", "app"]
