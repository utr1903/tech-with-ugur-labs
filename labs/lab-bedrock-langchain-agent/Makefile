# Reader entrypoint. Every target runs in containers; the host needs only
# Docker, Make and the AWS CLI.

# Settings in .env apply to every target, the same way Compose reads them.
-include .env
export

MODEL ?= kimi-k3
Q ?=

.DEFAULT_GOAL := help
.PHONY: help login check up down ask test e2e logs

help: ## Show the available targets
	@grep -E '^[a-z0-9]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk -F ':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'

login: ## Sign in to AWS with your browser (no access keys)
	aws login

check: ## Verify sign-in, Region and access to all four models
	./scripts/check.sh

up: check ## Build and start the stack, wait until it is ready
	docker compose up -d --build --wait

down: ## Stop the stack and delete the database volume
	docker compose --profile test down --volumes --remove-orphans

ask: ## Ask one question: make ask MODEL=kimi-k3 Q="..."
	docker compose exec -e MODEL -e Q app npm run --silent ask

test: ## Run the unit tests (no AWS needed)
	docker compose --profile test run --rm --build test npm test

e2e: ## Ask 5 questions on 4 models and print the result grid
	docker compose exec app npm run --silent e2e

logs: ## Follow the app's structured logs
	docker compose logs -f app
