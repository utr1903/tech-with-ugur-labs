# Reader entrypoint. Hermes runs in Docker on Gemma 4 through Vertex AI;
# the harness container drives it. Make never reads .env itself: Compose
# does, so the API server key stays out of your shell.

REPEATS ?= 1
export REPEATS
ADC_FILE ?= $(HOME)/.config/gcloud/application_default_credentials.json

# --build: after a git pull the harness image would otherwise keep running
# the old code, because compose only builds an image that does not exist yet.
HARNESS := docker compose --profile tools run --rm --build harness
# For commands that never talk to Hermes, so it is not started for them.
HARNESS_OFFLINE := docker compose --profile tools run --rm --build --no-deps harness
LAB_VOLUMES := twu-hermes-full-learn twu-hermes-full-control twu-hermes-flat-learn twu-hermes-flat-control

.DEFAULT_GOAL := help
.PHONY: help doctor vertex env fixtures up run curator report leak-check e2e down test

help: ## Show the available targets
	@grep -E '^[a-z0-9-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

doctor: ## Check Docker, gcloud, ADC, the Vertex AI API and the model
	ADC_FILE="$(ADC_FILE)" ./scripts/doctor.sh

vertex: ## Enable the Vertex AI API in your gcloud default project
	gcloud services enable aiplatform.googleapis.com

env: ## Create .env with your project, ids and a fresh key (never overwrites)
	./scripts/make_env.sh

fixtures: ## Prove the committed data/ matches the generator (read-only check)
	@mkdir -p results out
	@code=0; $(HARNESS_OFFLINE) fixtures --check || code=$$?; \
	  echo "exit=$$code" > results/fixtures-check.txt; exit $$code

up: ## Start Hermes on the full-learn home and check it end to end
	@mkdir -p results out
	docker compose up -d --wait hermes
	$(HARNESS) check --home full-learn

run: ## Run the six-cell matrix on fresh homes: make run [REPEATS=1]
	@mkdir -p results out
	./scripts/matrix.sh

curator: ## Curator dry run and status for both learn homes
	./scripts/curator.sh

report: ## Summarise every run into results/metrics.md (offline)
	@mkdir -p results
	$(HARNESS_OFFLINE) report

leak-check: ## Scan results/ and out/ for the API key and ADC secrets
	@mkdir -p results out
	docker compose --profile tools run --rm --build --no-deps \
	  -v "$(ADC_FILE):/adc/adc.json:ro" harness leak-check

# The stages share results/ and must run in this order, so they are sequenced
# in one recipe instead of prerequisites (which `make -j` would parallelise).
e2e: ## The full end-to-end run and its assertions: make e2e [REPEATS=1]
	$(MAKE) fixtures
	$(MAKE) run REPEATS=$(REPEATS)
	$(MAKE) curator
	$(MAKE) report
	$(MAKE) leak-check
	$(HARNESS_OFFLINE) assert-e2e

down: ## Stop everything and delete the four lab home volumes
	-docker compose --profile tools down
	@status=0; \
	for v in $(LAB_VOLUMES); do docker volume rm -f "$$v" >/dev/null || status=1; done; \
	exit $$status

test: ## Harness tests, lint and types in Docker; shellcheck
	docker build --target test harness
	shellcheck scripts/*.sh
