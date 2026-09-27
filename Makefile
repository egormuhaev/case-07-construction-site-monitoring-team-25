.PHONY: up down logs seed dump-classifiers reset

COMPOSE = docker compose

up:
	$(COMPOSE) up --build -d --remove-orphans

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f core-api detecting planning web

seed:
	python scripts/seed.py

dump-classifiers:
	python scripts/export_classifier_dumps.py

reset:
	$(COMPOSE) down -v
	rm -rf shared/projects shared/workflows shared/.idempotency
