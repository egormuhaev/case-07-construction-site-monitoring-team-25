.PHONY: up down build logs seed dump-classifiers reset

COMPOSE = docker compose

# Поднять уже собранные образы без пересборки.
up:
	$(COMPOSE) up -d --remove-orphans

# Сборка с кешем слоёв (torch и npm не перекачиваются при правках кода).
build:
	$(COMPOSE) build

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f core-api detecting planning analysis web

seed:
	python scripts/seed.py

dump-classifiers:
	python scripts/export_classifier_dumps.py

reset:
	$(COMPOSE) down -v
	rm -rf shared/projects shared/workflows shared/.idempotency
