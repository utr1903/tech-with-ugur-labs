FROM python:3.12-slim

RUN pip install --no-cache-dir "setuptools==75.6.0" "wheel==0.45.1"

WORKDIR /app
COPY serve.py .

EXPOSE 8000
CMD ["python", "serve.py"]
