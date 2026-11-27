# Reader entrypoint. Cloud targets delegate to scripts/deploy_cloud.sh;
# everything that talks to the VM goes through scripts/vm_ssh.sh.
# Only the recipes that run Terraform set TF_VAR_allowed_ssh_cidr, so
# `make score` and the other laptop-only targets never touch the network
# or Terraform. Set ALLOWED_SSH_CIDR=203.0.113.7/32 to skip the IP lookup.

REGION ?= eu-central-1
export REGION
# GPU capacity varies by zone: make up ZONE=eu-central-1b if 1a is short.
ZONE ?= eu-central-1a
# What the caller passed, before the lookup default below fills it in.
GIVEN_SSH_CIDR := $(ALLOWED_SSH_CIDR)
ALLOWED_SSH_CIDR ?= $(shell ./scripts/my_ip.sh)
RUNS ?= 3
QUESTION ?= all

BENCH := docker compose run --rm bench
TF_ENV = export TF_VAR_region="$(REGION)" TF_VAR_availability_zone="$(ZONE)" TF_VAR_allowed_ssh_cidr="$(ALLOWED_SSH_CIDR)"
# Destroy ignores the SSH rule, so it must not depend on the IP lookup: a
# failed lookup would otherwise leave the GPU running. 192.0.2.1 is a
# documentation address that only satisfies the variable's validation.
TF_DOWN_ENV = export TF_VAR_region="$(REGION)" TF_VAR_availability_zone="$(ZONE)" TF_VAR_allowed_ssh_cidr="$(or $(GIVEN_SSH_CIDR),192.0.2.1/32)"

.DEFAULT_GOAL := help
.PHONY: help doctor env plan up down tunnel tunnel-down check ssh truth truth-check research frontier score test

help: ## Show the available targets
	@grep -E '^[a-z-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

doctor: ## Check local tools, Docker, AWS login and GPU quota
	./scripts/doctor.sh

env: ## Create .env with generated secrets (never overwrites)
	./scripts/make_env.sh

plan: ## Preview what `make up` would create
	$(TF_ENV) && ./scripts/deploy_cloud.sh --dry-run

up: ## Deploy the GPU VM, open the tunnel, start the laptop stack, verify
	$(TF_ENV) && ./scripts/deploy_cloud.sh
	./scripts/tunnel.sh open
	docker compose up -d --wait
	$(MAKE) check

down: ## Destroy everything and prove nothing is left
	-docker compose --profile tools down
	-./scripts/tunnel.sh close
	$(TF_DOWN_ENV) && ./scripts/deploy_cloud.sh --destroy
	./scripts/check_leftovers.sh
	@echo "terraform state list (must print nothing):"
	@state="$$(terraform -chdir=terraform state list)" && echo "$$state" && test -z "$$state"

tunnel: ## Open (or reopen) the SSH tunnel to the model
	./scripts/tunnel.sh open

tunnel-down: ## Close the SSH tunnel
	./scripts/tunnel.sh close

check: ## Prove the model answers through the tunnel and not on the public IP
	./scripts/reach_check.sh

ssh: ## Open a shell on the VM
	./scripts/vm_ssh.sh ssh -t

truth: ## Rebuild the answer keys from CISA and SEC (rewrites data/truth)
	@mkdir -p data results
	$(BENCH) truth

truth-check: ## Compare live CISA/SEC data with the committed answer keys
	@mkdir -p data results
	$(BENCH) truth --check

research: ## Run Local Deep Research: make research [RUNS=3] [QUESTION=all]
	@mkdir -p data results
	$(BENCH) research --question $(QUESTION) --runs $(RUNS)

frontier: ## Run Gemini Deep Research: make frontier [RUNS=3] [QUESTION=all]
	@mkdir -p data results
	$(BENCH) frontier --question $(QUESTION) --runs $(RUNS)

score: ## Score every run file against the answer keys (offline)
	@mkdir -p data results
	$(BENCH) score

test: ## Bench tests, lint and types in Docker; Terraform tests; shellcheck
	docker build --target test bench
	terraform -chdir=terraform init -backend=false -input=false >/dev/null
	terraform -chdir=terraform test
	shellcheck scripts/*.sh vm/host/*.sh vm/bin/*.sh
