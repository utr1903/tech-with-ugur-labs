FROM python:3.12-slim

RUN pip install --no-cache-dir "pytest==8.3.4"

WORKDIR /harness
COPY report.py test_sandbox.py .

CMD ["python", "-m", "pytest", "-q"]
