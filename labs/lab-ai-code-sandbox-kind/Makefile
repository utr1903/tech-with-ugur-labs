SHELL := /bin/bash
CLUSTER := ai-code-sandbox
CONTEXT := kind-$(CLUSTER)
NAMESPACE := code-sandbox
KUBECTL := kubectl --context $(CONTEXT) -n $(NAMESPACE)
LLM_MODE ?= scripted
WEB_PORT ?= 3000
IMAGE_PREFIX := lab-ai-code-sandbox
FORWARD_PID := .forward.pid
PREV_CONTEXT_FILE := .previous-context

.PHONY: help cluster build load secrets deploy forward up e2e e2e-live e2e-deps logs down

help:
	@echo "make up        create the cluster, build and deploy everything, forward http://localhost:$(WEB_PORT)"
	@echo "make e2e       keyless end-to-end suite (scripted model)"
	@echo "make e2e-live  same checks against Anthropic (needs ANTHROPIC_API_KEY)"
	@echo "make logs      recent logs of server, sandbox and web"
	@echo "make down      stop the port-forward and delete this lab's cluster"

# `kind create cluster` silently switches the reader's current kube context,
# and it does so before its own node-Ready wait finishes - so a timed-out
# wait would otherwise strand the reader on kind-ai-code-sandbox. Stash,
# create-or-skip, restore and cleanup all happen in one shell invocation so
# the restore always runs (even on failure) before the exit code propagates;
# splitting these across separate recipe lines would let Make abort at the
# first failing line and skip the restore.
cluster:
	@kubectl config current-context > $(PREV_CONTEXT_FILE) 2>/dev/null || true; \
	if kind get clusters | grep -qx '$(CLUSTER)'; then echo "kind cluster $(CLUSTER) already exists"; rc=0; \
	else kind create cluster --name $(CLUSTER) --config kind/cluster.yaml --wait 120s; rc=$$?; fi; \
	if [ -s $(PREV_CONTEXT_FILE) ]; then kubectl config use-context "$$(cat $(PREV_CONTEXT_FILE))" >/dev/null 2>&1 || true; fi; \
	rm -f $(PREV_CONTEXT_FILE); exit $$rc

build:
	docker build -t $(IMAGE_PREFIX)/sandbox:local sandbox
	docker build -t $(IMAGE_PREFIX)/server:local server
	docker build -t $(IMAGE_PREFIX)/web:local web

load:
	kind load docker-image --name $(CLUSTER) $(IMAGE_PREFIX)/sandbox:local $(IMAGE_PREFIX)/server:local $(IMAGE_PREFIX)/web:local

secrets:
	@kubectl --context $(CONTEXT) apply -f deploy/namespace.yaml
	@if ! $(KUBECTL) get secret postgres-credentials >/dev/null 2>&1; then \
		openssl rand -hex 24 | tr -d '\n' | $(KUBECTL) create secret generic postgres-credentials --from-file=password=/dev/stdin; \
	fi
	@if [ -n "$$ANTHROPIC_API_KEY" ]; then \
		printf '%s' "$$ANTHROPIC_API_KEY" | $(KUBECTL) create secret generic anthropic --from-file=api-key=/dev/stdin --dry-run=client -o yaml | $(KUBECTL) apply -f - >/dev/null; \
		echo "secret/anthropic updated from ANTHROPIC_API_KEY"; \
	elif [ "$(LLM_MODE)" = "live" ]; then \
		echo "LLM_MODE=live needs ANTHROPIC_API_KEY in your shell" >&2; exit 1; \
	fi

deploy:
	@kubectl --context $(CONTEXT) apply -f deploy/namespace.yaml
	$(KUBECTL) create configmap server-mode --from-literal=LLM_MODE=$(LLM_MODE) --dry-run=client -o yaml | $(KUBECTL) apply -f -
	kubectl --context $(CONTEXT) apply -k deploy
	$(KUBECTL) rollout restart deployment/sandbox deployment/server deployment/web
	$(KUBECTL) rollout status statefulset/postgres --timeout=180s
	$(KUBECTL) rollout status deployment/sandbox --timeout=180s
	$(KUBECTL) rollout status deployment/server --timeout=240s
	$(KUBECTL) rollout status deployment/web --timeout=180s

forward:
	@# kubectl port-forward svc/web pins to whichever web pod backed the
	@# service when the tunnel was opened; a later rollout restart replaces
	@# that pod and leaves the old tunnel dangling. So a live PID alone
	@# does not mean the forward still works: probe it, and restart the
	@# tunnel if the probe fails.
	@if [ -f $(FORWARD_PID) ] && kill -0 $$(cat $(FORWARD_PID)) 2>/dev/null && curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:$(WEB_PORT)/api/tools 2>/dev/null; then \
		echo "port-forward already running"; \
	else \
		if [ -f $(FORWARD_PID) ]; then kill $$(cat $(FORWARD_PID)) 2>/dev/null || true; fi; \
		nohup $(KUBECTL) port-forward svc/web $(WEB_PORT):3000 >.forward.log 2>&1 & echo $$! > $(FORWARD_PID); \
	fi
	@for i in $$(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:$(WEB_PORT)/api/tools && break; sleep 1; done
	@curl -fsS -o /dev/null http://127.0.0.1:$(WEB_PORT)/api/tools || { echo "web app not reachable; see .forward.log" >&2; exit 1; }
	@echo "Chat app: http://localhost:$(WEB_PORT)"

up:
	$(MAKE) cluster build load secrets deploy forward LLM_MODE=$(LLM_MODE)

e2e-deps:
	cd e2e && npm ci && npx playwright install chromium

e2e: e2e-deps
	cd e2e && npm run e2e

e2e-live: e2e-deps
	@[ -n "$$ANTHROPIC_API_KEY" ] || { echo "make e2e-live needs ANTHROPIC_API_KEY in your shell" >&2; exit 1; }
	$(MAKE) secrets deploy LLM_MODE=live
	cd e2e && npm run e2e:live

logs:
	$(KUBECTL) logs deployment/server --tail=100
	$(KUBECTL) logs deployment/sandbox --tail=100
	$(KUBECTL) logs deployment/web --tail=50

# `kind delete cluster` also switches the current kube context (to whatever
# remains, or unsets it), and can fail partway through. Same reasoning as
# `cluster`: stash, delete, restore and cleanup run as one shell invocation
# so the restore is unconditional and the reader's context is never left
# changed, even if `kind delete cluster` itself fails.
down:
	@if [ -f $(FORWARD_PID) ]; then kill $$(cat $(FORWARD_PID)) 2>/dev/null || true; rm -f $(FORWARD_PID) .forward.log; fi
	@kubectl config current-context > $(PREV_CONTEXT_FILE) 2>/dev/null || true; \
	kind delete cluster --name $(CLUSTER); rc=$$?; \
	if [ -s $(PREV_CONTEXT_FILE) ]; then kubectl config use-context "$$(cat $(PREV_CONTEXT_FILE))" >/dev/null 2>&1 || true; fi; \
	rm -f $(PREV_CONTEXT_FILE); exit $$rc
