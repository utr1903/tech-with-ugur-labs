SHELL := /bin/bash
KIND_CLUSTER ?= ai-soc

.PHONY: help cluster infra tenants down

help:
	@echo "make cluster  create the $(KIND_CLUSTER) kind cluster (audit logging on)"
	@echo "make infra    cluster + Tetragon, Loki, Fluent Bit and Alertmanager"
	@echo "make tenants  build and deploy the mock tenant workloads"
	@echo "make down     delete the $(KIND_CLUSTER) cluster"

# `kind create cluster` silently switches the reader's current kube context.
# Remember it, create-or-skip, then restore it - all in one shell invocation
# so the restore always runs, even if the create fails.
# The kind config references infra/audit-policy.yaml relative to this
# directory, so kind must run from here (make does).
cluster:
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	if kind get clusters | grep -qx '$(KIND_CLUSTER)'; then echo "kind cluster $(KIND_CLUSTER) already exists"; rc=0; \
	else kind create cluster --name $(KIND_CLUSTER) --config infra/kind-config.yaml --wait 120s; rc=$$?; fi; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc

infra: cluster
	./scripts/up-infra.sh

tenants:
	./scripts/up-tenants.sh

# `kind delete cluster` also switches the current kube context; restore it.
down:
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	kind delete cluster --name $(KIND_CLUSTER); rc=$$?; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc
