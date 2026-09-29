# Мониторинг строительной площадки

Система: проекты, календарный план, кадры с камер, детекция техники и сверка план/факт.

```
браузер → :12080 (web/nginx) → :12300 /api (core-api)
                                 │
                    Postgres :12432    Redis :12679    том ./shared
                                 │
                    planning :12801    detecting :12800    analysis :12802
```

---

## Что должно быть на машине

- Docker Engine и Docker Compose v2 (`docker compose version`)
- GNU Make
- Python 3.10 или новее (только на хосте, для сидера классификаторов)
- Сеть для первой сборки: качается CPU-сборка PyTorch и npm-зависимости
- Диск: образы детекции и планирования крупные; плюс тома весов и кэша моделей
- Архитектура образов в compose задана как `linux/amd64` (на Apple Silicon пойдёт через эмуляцию, сборка и детекция будут медленнее)

GPU не требуется: detecting и planning собираются с CPU-Torch.

Учётки пользователей в системе нет. Пароли БД в compose по умолчанию — `admin` / `admin_password`. Для внешнего контура смените их до первого `up` и не публикуйте порты БД/Redis без нужды.

---



## 1. Получить код

```bash
git clone <url-репозитория>
cd monitoring-construction-site
```

Для сидера с хоста нужны файлы классификаторов:

- предпочтительно `dataset/dumps/*.csv.gz` (согласованный дамп: машины, работы, нормализованные имена, векторы);
- иначе `dataset/documents/Классификатор Версия №43.xlsx` и `dataset/classifier/classifier.json` (без векторов — автосопоставление плана будет слабым).

Дампы в git не хранятся. Если их нет — возьмите у команды или снимите с уже заполненной БД командой `make dump-classifiers`.

---



## 2. Окружение на хосте (для сидера)

Compose **не читает** `.env` для сервисов: хост, пароли и cron прописаны в `docker-compose.yml`. Файл `.env` нужен скриптам на хосте (`seed`, дампы).

```bash
cp .env.example .env
```

Значения по умолчанию совпадают с compose. Менять имеет смысл, если пробросили другие порты Postgres:


| Переменная                            | Зачем сидеру                              | По умолчанию               |
| ------------------------------------- | ----------------------------------------- | -------------------------- |
| `POSTGRES_HOST`                       | хост с машины, где запускаете `make seed` | `localhost`                |
| `POSTGRES_PORT`                       | внешний порт                              | `12432`                    |
| `POSTGRES_DB`                         | база                                      | `monitoring_db`            |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | учётка                                    | `admin` / `admin_password` |


Пароли в контейнерах меняйте в `docker-compose.yml` (сервисы `db`, `core-api`, `planning`, `analysis`) и в `.env` для сидера — одними и теми же значениями.

---



## 3. Собрать образы

Первая сборка долгая: слой Torch для detecting и planning.

```bash
make build
```

Это `docker compose build` с кешем слоёв. Повторно зависимости не качаются, если не сменился `pyproject.toml` / lockfile.

Если сборка detecting/planning оборвалась по сети:

```bash
make build
```

ещё раз — кеш слоёв сохранится до упавшего шага.

---



## 4. Поднять контейнеры

```bash
make up
```

Поднимаются: `db`, `redis`, `detecting`, `planning`, `analysis`, `core-api`, `web`.  
`core-api` ждёт healthy у БД, Redis и трёх Python-сервисов. Миграции Postgres накатывает **core-api при старте** из `deploy/db/migrations`. `synchronize` у TypeORM выключен.

Каталог `./shared` монтируется в контейнеры как `/data` (планы и кадры). При необходимости создайте его заранее:

```bash
mkdir -p shared
```

Дождитесь здоровья:

```bash
docker compose ps
curl -sf http://localhost:12300/health && echo core-api_ok
curl -sf http://localhost:12800/health && echo detecting_ok
curl -sf http://localhost:12801/health && echo planning_ok
curl -sf http://localhost:12802/health && echo analysis_ok
```

Интерфейс: [http://localhost:12080](http://localhost:12080)  
API: [http://localhost:12300/api](http://localhost:12300/api)  

Пока `core-api` в restart/unhealthy, сидер и UI не заведутся — смотрите `make logs`.

---



## 5. Залить классификаторы

С хоста, когда Postgres уже слушает `localhost:12432` и миграции накатаны.

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[seed]"
make seed
```

Ожидаемый вывод: счётчики `machine_classifier`, `work_classifier`, `detection_class`, связка машин с группами детекции.

- Есть `dataset/dumps/*.csv.gz` — заливаются дампы (UUID сохраняются, векторы на месте).
- Дампов нет — Excel/JSON, таблица векторов пустая. Сопоставление плана после импорта `.mpp` будет хуже, пока не появятся векторы.
- Классификаторы уже в БД — повторный `make seed` их не затирает. Полная перезаливка:

```bash
python scripts/seed.py --reload
```

Только векторы/нормализация из дампов:

```bash
python scripts/seed.py --reload-dumps
```

Снять дамп с текущей заполненной базы:

```bash
make dump-classifiers
```

Файлы пишутся в `dataset/dumps/` (в git игнорируются). Их нужно хранить рядом с релизом или в артефактах, иначе следующий чистый стенд поднимется без векторов.

---



## 6. Проверить, что стенд живой

1. Откройте [http://localhost:12080](http://localhost:12080) — список проектов.
2. Создайте проект, загрузите `.mpp` — статус плана должен дойти до **Готов**.
3. На вкладке **План** должны быть работы (без векторов нормы часто пустые или слабые).
4. Загрузите кадр на день и нажмите **Запустить детекцию**. Первый прогон detecting качает веса в том `detecting-weights` — это может занять много времени.

Если UI открывается, а `/api` нет — смотрите `web` (nginx проксирует `/api` на `core-api:3000`) и логи `core-api`.

---



## Порты на хосте

Все внешние порты в диапазоне **12xxx**, чтобы не пересекаться с другими стеками на машине.


| Сервис      | Хост      | Внутри сети | Назначение                                     |
| ----------- | --------- | ----------- | ---------------------------------------------- |
| `web`       | **12080** | 80          | UI; `/api` и `/health` проксируются в core-api |
| `core-api`  | **12300** | 3000        | REST, ingest камер, health                     |
| `detecting` | **12800** | 8000        | job-ы детекции                                 |
| `planning`  | **12801** | 8001        | job-ы импорта плана                            |
| `analysis`  | **12802** | 8002        | job-ы сверки план/факт                         |
| `db`        | **12432** | 5432        | Postgres + pgvector                            |
| `redis`     | **12679** | 6379        | очереди BullMQ и чекпоинты job-ов              |


Камеры с площадки должны достучаться до `http://<хост>:12300/api/ingest/images` (или до `:12080/api/...`). Подробно — [КАМЕРЫ.md](КАМЕРЫ.md).

---



## Ежедневные команды

```bash
make up                 # старт без пересборки
make down               # стоп, тома на диске остаются
make build              # пересборка образов
make logs               # core-api, detecting, planning, analysis, web
make seed               # классификаторы (идемпотентно, если уже залиты)
make dump-classifiers   # снять дамп справочников из БД
make reset              # down -v + очистка shared/projects, workflows, .idempotency
```

Логи одного сервиса:

```bash
docker compose logs -f core-api
docker compose logs -f detecting
```

Перезапуск после смены переменных в `docker-compose.yml`:

```bash
docker compose up -d --force-recreate <сервис>
```

---



## Данные и тома


| Где                                              | Что                      |
| ------------------------------------------------ | ------------------------ |
| named volume `monitoring_db_data`                | Postgres                 |
| named volume `redis-data`                        | Redis AOF                |
| named volume `detecting-weights`                 | веса YOLO / моделей      |
| named volume `detecting-cache`, `planning-cache` | кэш HuggingFace и прочее |
| `./shared` → `/data`                             | планы и кадры            |


Пути на томе:

```text
/data/projects/{projectId}/plans/{planId}.mpp
/data/projects/{projectId}/days/{YYYY-MM-DD}/{imageId}.jpg
```

Бэкап минимума: том Postgres + каталог `./shared` + при наличии `dataset/dumps`. Веса detecting можно не бэкапить — скачаются снова при первом прогоне (дольше старт).

`make reset` **удаляет** том БД и файлы проектов в `shared`. Классификаторы после reset нужно залить снова (`make seed`).

---



## Расписания (core-api)

В compose задано:

- `DETECTION_CRON=0 3 * * *`, `DETECTION_TZ=Europe/Moscow` — ночная детекция вчерашних дней в статусе «сбор кадров», если есть кадры и день не запускали вручную;
- `ANALYSIS_CRON=0 4 * * *` — подстраховка дневного анализа, если детекция уже есть, а отчёта нет.

После приёма кадра ingest детекция **сама не стартует**. Смена cron — в `docker-compose.yml` у `core-api`, затем recreate сервиса.

Нормализация названий плана через LLM выключена (`PLANNING_NORMALIZE_ENABLED=false`). Включение: в сервисе `planning` выставить `true` и задать `PLANNING_LLM_TOKEN` (см. `.env.example`).

---



## Полный сброс стенда

```bash
make reset
make up
source .venv/bin/activate
make seed
```

После этого БД пустая по проектам, справочники снова из дампа или Excel/JSON.

---



## Если не поднимается

`core-api` **unhealthy, остальное ok.** Миграции или зависимость. `docker compose logs core-api`. Сидер при этом пишет «схема ещё не накатана» — сначала дождитесь healthy `core-api`.

`detecting` **/** `planning` **долго** `created` **на** `build`**.** Качается Torch. Не прерывайте без нужды; повторите `make build`.

`make seed`**: connection refused.** Контейнер `db` не слушает `localhost:12432`, либо в `.env` другой порт. Проверьте `docker compose ps` и `POSTGRES_PORT`.

`make seed`**: нет таблиц.** core-api не стартовал или упал на миграции.

**Импорт** `.mpp` **падает.** Смотрите логи `planning` (нужен JRE в образе — он уже в Dockerfile). Файл должен быть `.mpp` / `.xml`.

**Детекция висит на первом запуске.** Качаются веса в `detecting-weights`. Смотрите `docker compose logs -f detecting`.

**UI есть, API 502.** `core-api` ещё не healthy или упал после старта nginx.

**Камеры не доходят.** Порт 12300 (или 12080) закрыт с площадки; неверный токен; поле файлов не `files`. См. [КАМЕРЫ.md](КАМЕРЫ.md).

---



## Состав сервисов


| Сервис      | Роль                                    |
| ----------- | --------------------------------------- |
| `web`       | React, nginx                            |
| `core-api`  | домен, ingest, workflow, cron, миграции |
| `planning`  | разбор `.mpp`, векторы, запись работ    |
| `detecting` | детекция на кадрах                      |
| `analysis`  | дневной и периодный план/факт           |
| `db`        | Postgres `monitoring_db` + pgvector     |
| `redis`     | очереди и чекпоинты job-ов              |


Пайплайны: `services/core-api/config/pipeline.json` (`plan-import`, `day-detection`, `day-analysis`, `period-analysis`). Job-сервис: `POST /jobs` + `GET /jobs/{id}`, идемпотентность по `requestId`.

Локальные extras Python (не нужны для compose-стенда):

```bash
pip install -e ".[detecting]"
pip install -e ".[planning]"
pip install -e ".[analysis]"
pip install -e ".[calendar]"
pip install -e ".[seed]"
```

