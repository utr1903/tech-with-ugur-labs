# INSECURE-BY-DESIGN: old python:3.9-slim-bullseye base image (EOL Python 3.9, Debian 11) pinned by multi-arch index digest, known OS and Python CVEs
FROM python:3.9-slim-bullseye@sha256:b9e06687fbfc57f6fe563e94e4c8751e39513dde89afc120dc6f56afe5ffc761

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

EXPOSE 8080

# INSECURE-BY-DESIGN: no USER instruction, the app runs as root
CMD ["python", "app.py"]
