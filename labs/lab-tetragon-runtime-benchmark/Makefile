SHELL := /bin/bash
KIND_CLUSTER ?= tetragon-bench
RUNS ?= 3

.PHONY: help cluster up bench behaviour down test e2e

help:
	@echo "make up         create the kind cluster and install Tetragon"
	@echo "make bench      run the benchmark scenarios (RUNS=$(RUNS) per scenario)"
	@echo "make behaviour  run the behaviour demos"
	@echo "make test       lint, type-check and unit-test the runner"
	@echo "make e2e        full end-to-end check against the cluster"
	@echo "make down       delete the $(KIND_CLUSTER) cluster"

# `kind create cluster` silently switches the reader's current kube context.
# Remember it, create-or-skip, then restore it - all in one shell invocation
# so the restore always runs, even if the create fails.
cluster:
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	if kind get clusters | grep -qx '$(KIND_CLUSTER)'; then echo "kind cluster $(KIND_CLUSTER) already exists"; rc=0; \
	else kind create cluster --name $(KIND_CLUSTER) --config infra/kind-config.yaml --wait 120s; rc=$$?; fi; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc

up:
	./scripts/up.sh

bench:
	cd runner && uv run app bench --runs $(RUNS)

behaviour:
	cd runner && uv run app behaviour

test:
	cd runner && uv run ruff check && uv run ruff format --check && uv run mypy && uv run pytest && uv run deptry src

e2e:
	@echo "e2e is not available yet" >&2; exit 1

# `kind delete cluster` also switches the current kube context; restore it.
down:
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	kind delete cluster --name $(KIND_CLUSTER); rc=$$?; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc
