# Reader entrypoint. Cloud targets delegate to scripts/deploy_cloud.sh;
# everything on the VM goes through scripts/vm_ssh.sh.

REGION ?= eu-central-1
export REGION
export TF_VAR_region := $(REGION)

.DEFAULT_GOAL := help
.PHONY: help doctor cloud-plan cloud-up destroy ssh tf-test lint-scripts test selftest

help: ## Show the available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk -F ':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

doctor: ## Check local tools, AWS login and GPU quota
	./scripts/doctor.sh

cloud-plan: ## Preview what cloud-up would create
	./scripts/deploy_cloud.sh --dry-run

cloud-up: ## Deploy everything; returns when the model answers
	./scripts/deploy_cloud.sh

destroy: ## Delete everything, then check that nothing is left
	./scripts/deploy_cloud.sh --destroy
	./scripts/check_leftovers.sh

ssh: ## Open a shell on the VM
	./scripts/vm_ssh.sh ssh -t

tf-test: ## Plan-only security tests of the Terraform code (no AWS calls)
	terraform -chdir=terraform init -backend=false -input=false >/dev/null
	terraform -chdir=terraform test

lint-scripts: ## shellcheck every script
	shellcheck scripts/*.sh vm/host/*.sh $(wildcard vm/bin/*.sh) $(wildcard vm/coder/*.sh)

test: ## Run the tools app's tests and lint in Docker (laptop, no cloud)
	docker build --target test vm/tools

selftest: ## Verify the reference solution with the real verifier (laptop, no cloud)
	./scripts/selftest.sh
