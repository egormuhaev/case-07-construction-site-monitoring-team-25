.PHONY: up down logs reset

COMPOSE = docker compose -f ../docker-compose.yml

up:
	$(COMPOSE) up --build -d db redis orchestrator

down:
	$(COMPOSE) down db redis orchestrator

logs:
	$(COMPOSE) logs -f orchestrator

reset:
	$(COMPOSE) down -v db redis orchestrator
	rm -rf shared/workflows shared/.idempotency
