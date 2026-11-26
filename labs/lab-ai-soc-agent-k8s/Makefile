SHELL := /bin/bash
KIND_CLUSTER ?= ai-soc

.PHONY: help cluster infra tenants outside detection secrets soc canaries up approvals approve deny reports hunt hunt-schedule-on hunt-schedule-off test down

help:
	@echo "make cluster  create the $(KIND_CLUSTER) kind cluster (audit logging on)"
	@echo "make infra    cluster + Tetragon, Loki, Fluent Bit and Alertmanager"
	@echo "make tenants  build and deploy the mock tenant workloads"
	@echo "make outside   start the attacker sinks and normal-user traffic (Docker Compose)"
	@echo "make detection  apply the Tetragon policies and Loki alert rules"
	@echo "make secrets  create the API key and token Secrets (needs ANTHROPIC_API_KEY in .env)"
	@echo "make soc      build and deploy the agent and responder"
	@echo "make up       everything above plus the two canaries (starts one paid investigation)"
	@echo "make approvals / approve ID=.. / deny ID=..  list and resolve pending actions"
	@echo "make reports  copy the agent reports to ./reports"
	@echo "make hunt     ask the agent for a proactive hunt (paid) and print the report id"
	@echo "make hunt-schedule-on / hunt-schedule-off  enable or suspend the 30 minute scheduled hunt (off by default)"
	@echo "make test     lint, typecheck, unit tests and knip in every package"
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

secrets:
	./scripts/secrets.sh

soc:
	./scripts/up-soc.sh

# The canaries are the only checks make up runs. They never call
# canary-detection-rules.sh, which fires six real alerts (six paid runs).
canaries:
	./scripts/canary-telemetry.sh --with-db
	./scripts/canary-detection.sh

# make runs prerequisites left to right, so this is the whole bring-up order.
up: cluster infra tenants detection secrets soc outside canaries

approvals:
	@./scripts/soc-call.sh responder admin-token GET /approvals; echo

approve:
	@test -n "$(ID)" || { echo "usage: make approve ID=<approval id>"; exit 2; }
	@./scripts/soc-call.sh responder admin-token POST "/approvals/$(ID)/approve"; echo

deny:
	@test -n "$(ID)" || { echo "usage: make deny ID=<approval id>"; exit 2; }
	@./scripts/soc-call.sh responder admin-token POST "/approvals/$(ID)/deny"; echo

reports:
	@mkdir -p reports
	@pod="$$(kubectl --context kind-$(KIND_CLUSTER) -n soc get pod -l app=soc-agent -o jsonpath='{.items[0].metadata.name}')"; \
	kubectl --context kind-$(KIND_CLUSTER) -n soc cp "$$pod:/data/reports" reports >/dev/null && ls reports

hunt-schedule-on hunt-schedule-off:
	@kubectl --context kind-$(KIND_CLUSTER) -n soc patch cronjob soc-hunt -p '{"spec":{"suspend":$(if $(filter hunt-schedule-off,$@),true,false)}}'

hunt:
	@./scripts/soc-call.sh agent agent-token POST /hunt '{}'; echo

test:
	@for p in tenants outside soc; do \
	  echo "== apps/$$p"; \
	  (cd apps/$$p && npm run lint && npm run typecheck && npm test && npm run knip) || exit 1; \
	done

# `kind delete cluster` also switches the current kube context; restore it.
down:
	@docker compose down --remove-orphans || true
	@prev="$$(kubectl config current-context 2>/dev/null || true)"; \
	kind delete cluster --name $(KIND_CLUSTER); rc=$$?; \
	if [ -n "$$prev" ]; then kubectl config use-context "$$prev" >/dev/null 2>&1 || true; fi; \
	exit $$rc
