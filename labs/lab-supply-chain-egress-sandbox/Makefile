COMPOSE = docker compose

.PHONY: build up demo test down clean

build:
	$(COMPOSE) build

# Fresh, healthy infrastructure (clears prior evidence).
up:
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d --build --wait mirror attacker proxy

demo: up
	@echo "===> UNSAFE install (straight onto the open network)"
	-$(COMPOSE) run --rm installer-unsafe
	@echo "===> SAFE install (inside the egress sandbox)"
	-$(COMPOSE) run --rm installer-safe
	@echo
	$(COMPOSE) run --rm harness python report.py
	$(COMPOSE) down -v --remove-orphans

test: up
	-$(COMPOSE) run --rm installer-unsafe
	-$(COMPOSE) run --rm installer-safe
	$(COMPOSE) run --rm harness python -m pytest -q
	$(COMPOSE) down -v --remove-orphans

down:
	$(COMPOSE) down -v --remove-orphans

clean:
	$(COMPOSE) down -v --remove-orphans --rmi local
