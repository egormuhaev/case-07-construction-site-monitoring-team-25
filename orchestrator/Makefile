.PHONY: up down logs reset

COMPOSE = docker compose -f ../docker-compose.yml

up:
	$(COMPOSE) up --build -d postgres redis orchestrator

down:
	$(COMPOSE) down postgres redis orchestrator

logs:
	$(COMPOSE) logs -f orchestrator

reset:
	$(COMPOSE) down -v postgres redis orchestrator
	rm -rf shared/workflows shared/.idempotency
