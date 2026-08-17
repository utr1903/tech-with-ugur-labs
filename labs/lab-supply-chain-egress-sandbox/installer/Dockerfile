FROM python:3.12-slim

# Present so `pip install --no-build-isolation` can build the sdist offline.
RUN pip install --no-cache-dir "pip==24.3.1" "setuptools==75.6.0" "wheel==0.45.1"

WORKDIR /work
COPY install.py .

CMD ["python", "install.py"]
