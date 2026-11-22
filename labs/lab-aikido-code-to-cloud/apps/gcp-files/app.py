"""Tiny file viewer backed by a GCS bucket. Deliberately vulnerable demo app
for Aikido Security; all data it serves is generated fake data."""
import os
import posixpath
from urllib.parse import quote

import requests
from flask import Flask, Response, request

BUCKET = os.environ["BUCKET"]
APP_ENV = os.environ.get("APP_ENV", "dev")
METADATA_HOST = os.environ.get("METADATA_HOST", "metadata.google.internal")
GCS = "https://storage.googleapis.com/storage/v1/b/%s/o" % BUCKET

app = Flask(__name__)


def token():
    r = requests.get(
        "http://%s/computeMetadata/v1/instance/service-accounts/default/token" % METADATA_HOST,
        headers={"Metadata-Flavor": "Google"},
        timeout=5,
    )
    return r.json()["access_token"]


def auth():
    return {"Authorization": "Bearer " + token()}


@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/")
def index():
    try:
        r = requests.get(GCS, headers=auth(), params={"prefix": "public/"}, timeout=10)
    except requests.RequestException:
        return Response("storage unavailable", status=502)
    if r.status_code != 200:
        return Response("storage unavailable", status=502)
    names = [i["name"] for i in r.json().get("items", [])]
    links = "".join(
        '<li><a href="/files?name=%s">%s</a></li>' % (quote(n[len("public/"):]), n) for n in names
    )
    return "<h1>Files (%s)</h1><ul>%s</ul>" % (APP_ENV, links)


@app.get("/files")
def files():


    name = request.args.get("name", "")
    # INSECURE-BY-DESIGN: path traversal: normpath of "public/" + user input lets "../private/..." escape the public/ prefix
    obj = posixpath.normpath("public/" + name)
    try:
        r = requests.get(
            GCS + "/" + quote(obj, safe=""),
            headers=auth(),
            params={"alt": "media"},
            timeout=10,
        )
    except requests.RequestException:
        return Response("storage unavailable", status=502)
    if r.status_code == 404:
        return Response("not found", status=404)
    if r.status_code != 200:
        return Response("storage error", status=502)
    return Response(r.content, mimetype="application/octet-stream")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
