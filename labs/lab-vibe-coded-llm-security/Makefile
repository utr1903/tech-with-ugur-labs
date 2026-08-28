COMPOSE = docker compose

.PHONY: up e2e down clean

# Build and start the model, both apps and the attacker; wait until healthy.
# The first run pulls the model (~2 GB) and can take a few minutes.
# tmp/evidence holds the attacker's captured evidence (bind-mounted).
up:
	mkdir -p tmp/evidence
	$(COMPOSE) up -d --build --wait ollama app-vulnerable app-hardened attacker

# Run the four attacks and assert the outcomes; exits 0 on success.
e2e: up
	$(COMPOSE) run --rm runner
	$(COMPOSE) down --remove-orphans

# Stop everything, keep the pulled model volume and the tmp/ evidence.
down:
	$(COMPOSE) down --remove-orphans

# Stop everything and remove the model volume, built images and tmp/ evidence.
clean:
	$(COMPOSE) down -v --remove-orphans --rmi local
	rm -rf tmp
