# Мониторинг строительной площадки

Единая система: проекты, календарный план, кадры с камер и отчёт детекции.

```
services/web  →  REST  →  services/core-api (NestJS)
                               │
                    monitoring_db (pgvector)
                    Redis (BullMQ + job cache)
                    volume /data
                               │
              workflow-движок стартует job-ы
                               │
              services/planning     services/detecting
```

## Подъём

Нужны Docker и Python 3.10+ с зависимостями сидера.

```bash
cp .env.example .env   # по желанию, compose уже содержит значения по умолчанию
make up
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[seed]"
make seed
```

Клиент: http://localhost:8080  
API: http://localhost:3000/api  
Health: http://localhost:3000/health, detecting :8000, planning :8001.

`make seed` грузит классификаторы и связку `detection_class_machine`. Предпочтительный источник — согласованный дамп `dataset/dumps/*.csv.gz` (машины, работы, normalized, vector с теми же UUID):

```bash
make dump-classifiers   # снять с текущей БД
make seed               # или: python scripts/seed.py --reload
```

Без дампов seed заливает только Excel/JSON (без векторов). Классы детекции всегда из `equipment_group.py`.

Нормализация названий плана через LLM выключена. Включается `PLANNING_NORMALIZE_ENABLED=true` и `PLANNING_LLM_TOKEN`.

## Архитектура

Подробное описание компонентов, потоков данных, схемы БД и границ системы — в [ARCHITECTURE.md](ARCHITECTURE.md).

| Сервис | Роль |
| --- | --- |
| `services/web` | Vite + React + Gravity UI, nginx проксирует `/api` |
| `services/core-api` | Домен (проекты, планы, дни, ingest, детекция) и workflow-движок |
| `services/planning` | Разбор .mpp, векторизация, rerank, запись работ |
| `services/detecting` | Детекция техники и людей |
| `db` | Одна Postgres `monitoring_db` |
| `redis` | Очереди и чекпоинты job-ов |

Схема накатывается core-api при старте из `deploy/db/migrations`. `synchronize` выключен.

Пайплайны задаются в `services/core-api/config/pipeline.json`: `plan-import` и `day-detection`. Новый шаг — добавить сервис с контрактом `POST /jobs` + `GET /jobs/{id}` (идемпотентность по `requestId`) и дописать шаг в нужный пайплайн.

Файлы на общем томе `./shared` → `/data`:

- планы: `/data/projects/{projectId}/plans/{planId}.mpp`
- кадры: `/data/projects/{projectId}/days/{YYYY-MM-DD}/{imageId}.jpg`

## Ingest камер

`POST /api/ingest/images`

Заголовки: `X-Ingest-Token: <ingest_token проекта>`

Multipart:

- `projectId` — UUID проекта
- `files` — изображения
- `capturedAt` — ISO-8601 на каждый файл; если нет, берётся время приёма
- `cameraId` — внешний id камеры на каждый файл

День считается по `captured_at` в таймзоне проекта. Повтор с тем же checksum игнорируется. Если `cameraId` задан у всех кадров дня, detecting не кластеризует ракурсы DINOv2.

Ночная детекция: cron `0 3 * * *` `Europe/Moscow`, дни за вчера в статусе `COLLECTING`, без кадров и с ручным прогоном пропускаются.

## Python-пакеты

```
pip install -e ".[detecting]"
pip install -e ".[planning]"
pip install -e ".[calendar]"
pip install -e ".[seed]"
```

Скрипты `scripts/parse_calendar_plan.py`, `normalize_work.py`, `vectorize_work.py`, `rerank_classifier.py` — тонкие CLI над `services/planning`. Запись работ в БД делает сервис planning.

## Datasets

https://www.kaggle.com/datasets/xyzyxzzxy/construction-equipment
