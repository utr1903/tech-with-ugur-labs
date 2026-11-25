SHELL := /bin/bash
KIND_CLUSTER ?= ai-soc

.PHONY: help cluster infra tenants outside detection down

help:
	@echo "make cluster  create the $(KIND_CLUSTER) kind cluster (audit logging on)"
	@echo "make infra    cluster + Tetragon, Loki, Fluent Bit and Alertmanager"
	@echo "make tenants  build and deploy the mock tenant workloads"
	@echo "make outside   start the attacker sinks and normal-user traffic (Docker Compose)"
	@echo "make detection  apply the Tetragon policies and Loki alert rules"
	@echo "make down     stop the outside containers and delete the $(KIND_CLUSTER) cluster"

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

outside:
	docker compose up -d --build

detection:
	./scripts/up-detection.sh

# `kind delete cluster` also switches the current kube context; restore it.
down:
	@docker compose down --remove-orphans || true
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	kind delete cluster --name $(KIND_CLUSTER); rc=$$?; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc
