# Entry points for the Aikido code-to-cloud lab. Run them from this folder.
#   make repo DEST=$HOME/aikido-lab GH_REPO=<you>/aikido-lab   private copy with generated fake secrets
#   make deploy [YES=1] [ARGS="--skip-image ..."]            AWS + GCP + Aikido connections
#   make findings                                             snapshot of open Aikido issues
#   make destroy [YES=1]                                      Aikido clouds, Terraform, leftover report
#   make test                                                 offline checks (terraform test needs an AWS login)

SHELL := /usr/bin/env bash

.PHONY: help repo deploy findings destroy test test-scripts test-infra test-server test-gcp-files test-charts

help:
	@sed -n 's/^#   //p' $(firstword $(MAKEFILE_LIST))

repo:
	@test -n "$(DEST)" || { echo "DEST is required, e.g. make repo DEST=$$HOME/aikido-lab GH_REPO=<you>/aikido-lab" >&2; exit 2; }
	scripts/make-repo.sh "$(DEST)" $(GH_REPO)

deploy:
	scripts/deploy.sh $(if $(YES),--yes) $(ARGS)

findings:
	scripts/findings.sh

destroy:
	scripts/destroy.sh $(if $(YES),--yes)

test: test-scripts test-charts test-server test-gcp-files test-infra

test-scripts:
	shellcheck scripts/*.sh scripts/lib/*.sh
	bats scripts/tests

test-charts:
	apps/server/helm/tests/check_chart.sh
	apps/aikido-k8s/helm/tests/check_chart.sh

test-server:
	cd apps/server && npm ci --no-audit --no-fund && npx vitest run

test-gcp-files:
	cd apps/gcp-files && python3 -m venv .venv && .venv/bin/pip install -q -r requirements-dev.txt && .venv/bin/pytest -q

test-infra:
	terraform fmt -check -recursive infra
	terraform -chdir=infra init -backend=false -input=false > /dev/null
	terraform -chdir=infra validate
	terraform -chdir=infra test
