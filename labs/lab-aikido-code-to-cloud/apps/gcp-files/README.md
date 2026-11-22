# gcp-files

Deliberately vulnerable file viewer for the Aikido demo (path traversal, old
dependencies, old base image, runs as root). It serves generated fake data from
a GCS bucket.

Env: `BUCKET` (required), `APP_ENV` (default `dev`), `METADATA_HOST`.
Routes: `/healthz`, `/`, `/files?name=<n>`.

Deployed twice (dev and prod) by `make deploy` (`scripts/deploy.sh`) as a container on the GCP VM,
port 8080.

Tests: `requirements.txt` pins deliberately old packages for the image, which do
not install on the local Python 3.14. Run the tests with `requirements-dev.txt`
(current Flask/requests/pytest):

    python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
    .venv/bin/python -m pytest -q
