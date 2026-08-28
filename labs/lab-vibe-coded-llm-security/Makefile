COMPOSE = docker compose

.PHONY: up e2e down clean

# Build and start the model, both apps and the attacker; wait until healthy.
# The first run pulls the model (~2 GB) and can take a few minutes.
up:
	$(COMPOSE) up -d --build --wait ollama app-vulnerable app-hardened attacker

# Run the four attacks and assert the outcomes; exits 0 on success.
e2e: up
	$(COMPOSE) run --rm runner
	$(COMPOSE) down --remove-orphans

# Stop everything, keep the pulled model volume.
down:
	$(COMPOSE) down --remove-orphans

# Stop everything and remove the model volume and built images.
clean:
	$(COMPOSE) down -v --remove-orphans --rmi local
