# Reader entrypoint. Cloud targets delegate to scripts/deploy_cloud.sh;
# everything on the VM goes through scripts/vm_ssh.sh.

REGION ?= eu-central-1
export REGION
export TF_VAR_region := $(REGION)

TASK ?=
RUN ?= latest
TURNS ?= 150
WALL_TIME ?= 45m
DELAY_MS ?= 15
# Exported so scripts/check_vars.sh reads the values from its environment,
# not from Make's own text substitution into a recipe line.
export TASK RUN TURNS WALL_TIME DELAY_MS
VM := ./scripts/vm_ssh.sh

.DEFAULT_GOAL := help
.PHONY: help doctor cloud-plan cloud-up destroy ssh tf-test lint-scripts test selftest \
	model-check run watch status logs replay verify shell fetch-results replay-local containment-check

help: ## Show the available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk -F ':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

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

model-check: ## Check the model: served, tool calls parsed, speed and GPU memory
	$(VM) ssh /srv/lab/vm/bin/model-check.sh

run: ## Start a task and watch it live: make run TASK=log-summary
	@./scripts/check_vars.sh TASK TURNS WALL_TIME
	$(VM) rsync-up tasks/ /srv/lab/tasks/
	$(VM) ssh -t "run_id=\$$(/srv/lab/vm/bin/start-run.sh $(TASK) $(TURNS) $(WALL_TIME)) && /srv/lab/vm/bin/watch.sh \$$run_id"

watch: ## Reattach the live view: make watch [RUN=<id>]
	@./scripts/check_vars.sh RUN
	$(VM) ssh -t /srv/lab/vm/bin/watch.sh $(RUN)

status: ## State and exit code of a run: make status [RUN=<id>]
	@./scripts/check_vars.sh RUN
	$(VM) ssh /srv/lab/vm/bin/status.sh $(RUN)

logs: ## Follow the agent's raw log (stderr): make logs [RUN=<id>]
	@./scripts/check_vars.sh RUN
	$(VM) ssh -t /srv/lab/vm/bin/logs.sh $(RUN)

replay: ## Replay a finished run: make replay [RUN=<id>] [DELAY_MS=15]
	@./scripts/check_vars.sh RUN DELAY_MS
	$(VM) ssh -t /srv/lab/vm/bin/replay.sh $(RUN) $(DELAY_MS)

verify: ## Grade a finished run: make verify [RUN=<id>]
	@./scripts/check_vars.sh RUN
	$(VM) ssh /srv/lab/vm/bin/verify.sh $(RUN)

shell: ## Interactive Qwen Code session in tmux on the VM
	$(VM) ssh -t /srv/lab/vm/bin/shell.sh

fetch-results: ## Copy a run folder to ./results: make fetch-results [RUN=<id>]
	@./scripts/check_vars.sh RUN
	@mkdir -p results
	$(VM) rsync-down "$$($(VM) ssh /srv/lab/vm/bin/resolve-run.sh $(RUN))" results/

replay-local: ## Replay a fetched run on the laptop (Docker): make replay-local RUN=<id>
	@./scripts/check_vars.sh RUN DELAY_MS
	docker build -q --target runtime -t qwen-lab/tools vm/tools >/dev/null
	docker run --rm -t -v "$(CURDIR)/results/$(RUN):/run:ro" qwen-lab/tools replay /run --delay-ms $(DELAY_MS)

containment-check: ## Prove the sandbox and the network rules hold
	./scripts/containment_check.sh
