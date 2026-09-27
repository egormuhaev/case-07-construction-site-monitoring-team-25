# Мониторинг строительной площадки

Целевой CV стек: Ultralytics

## Работа с Python-частью

Python-пакеты лежат в `services/` и ставятся из корня репозитория как editable-пакет. Скрипты в `scripts/` и ноутбуки в `notebooks/` этим пакетом пользуются.

Нужны **Python 3.10+** и запуск команд из корня репозитория. Для нарезки видео — `ffmpeg` / `ffprobe`. Для локальной БД — Docker.

### Установка

```
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

После этого импортируется пакет `detecting`, а в PATH появляется команда `detecting`. Для скриптов календарного плана и БД:

```
pip install -e ".[calendar]"
```

Образ `detecting` ставит CPU-сборку `torch`/`torchvision` и только runtime сервиса, без extra `calendar`.

Новая библиотека сервиса — в `dependencies` в `pyproject.toml`, потом снова `pip install -e .`. Зависимости скриптов плана — в extra `calendar`.

### Структура

```
pyproject.toml          зависимости и точка входа detecting
services/detecting/     группировка кадров по ракурсу
scripts/                утилиты (БД, классификатор, нарезка видео)
notebooks/              эксперименты
dataset/                тестовые кадры, PDF/XLSX, классификатор
weights/                кэш весов (создаётся при первом запуске, в git не лежит)
```

Пакеты ищутся в `services/` (`tool.setuptools.packages.find`). Поэтому в коде пишите `from detecting...`, а не `from services.detecting...`.

### Группировка кадров по ракурсу

Сервис `detecting` читает изображения из `dataset/test-dataset`, считает эмбеддинги DINOv2, кластеризует ракурсы и печатает датасет с метками камер.

```
python -m detecting
```

или после установки:

```
detecting
```

При первом запуске модель `facebook/dinov2-small` скачивается и сохраняется в `weights/dinov2_small`. Повторные запуски читают веса с диска. Устройство выбирается автоматически: MPS → CUDA → CPU.

Пути и гиперпараметры — в `services/detecting/config.py`.

### Скрипты

Запускаются из корня репозитория, venv должен быть активен.

**База:** поднимает Postgres (docker compose), применяет миграции и заливает классификаторы.

```
python scripts/init_db.py
python scripts/init_db.py --skip-up    # база уже запущена
python scripts/init_db.py --reload     # перезалить данные, схему не трогать
python scripts/init_db.py --reset      # удалить таблицы и залить заново
```

Параметры подключения по умолчанию: `localhost:5432`, пользователь `admin`, БД `monitoring_db`. Их можно переопределить переменными `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

### Docker Compose

Единый Compose-файл находится в корне репозитория. Запуск инфраструктуры и
оркестратора:

```bash
docker compose up --build -d
```

Только основной PostgreSQL:

```bash
docker compose up -d db
```

Только оркестратор и его зависимости:

```bash
docker compose up --build -d db redis orchestrator
```

Сервис `detecting` в том же compose поднимает API детекции: образ ставит CPU-`torch` и зависимости сервиса, без extra `calendar`.

Последовательность внешних сервисов задаётся в
`orchestrator/orchestrator/config/pipeline.json`. Каждый сервис должен находиться
в общей Docker Compose сети, монтировать `./orchestrator/shared` в `/data` и
поддерживать асинхронный контракт `POST /jobs` + `GET /jobs/{jobId}`. Полная
инструкция находится в `orchestrator/README.md`.

**Классификатор работ** из PDF ГЭСН:

```
python scripts/parse_gesn_classifier.py
python scripts/parse_gesn_classifier.py --max-files 3 --output /tmp/gesn-test
```

**Векторы классификатора** (нужна уже залитая БД):

```
python scripts/create-classifier-vectors.py
```

**Нарезка видео** в папки по датам (нужен `ffmpeg`):

```
python scripts/video_to_dated_frames.py video.mp4 output_frames \
  --start-date 2025-01-01 \
  --frames-per-day 8
```

Кадр каждые пять секунд:

```
python scripts/video_to_dated_frames.py video.mp4 output_frames \
  --start-date 2025-01-01 \
  --frames-per-day 8 \
  --sample-every-seconds 5
```

Результат:

```
output_frames/
  2025-01-01/
    frame_001.jpg
    ...
  2025-01-02/
    ...
  manifest.csv
```

### Ноутбуки

В venv уже есть `ipykernel`. Из корня:

```
jupyter notebook notebooks/
```

В ядре ноутбука выберите `.venv`. Пакет `detecting` доступен так же, как в скриптах, потому что проект установлен через `pip install -e .`.

## Datasets

https://www.kaggle.com/datasets/xyzyxzzxy/construction-equipment

## Complected Models

https://huggingface.co/architchitte/Construction-Hazard-Detection

Архитектура: Yolo v5
Задачи: Детекция строительной техники
https://huggingface.co/uisikdag/yolo-v5-construction-machine-detection


Архитектура YOLO
Классы Building Equipment Worker
https://github.com/ciber-lab/pictor-yolo?ysclid=mu1g7ki1qa494927651


## building-facade-segmentation-instance Computer Vision Model:
https://universe.roboflow.com/building-facade/building-facade-segmentation-instance
