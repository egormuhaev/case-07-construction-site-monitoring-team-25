FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DETECTING_DATA_DIR=/data \
    DETECTING_WEIGHTS_DIR=/weights \
    DETECTING_CACHE_DIR=/cache

# Только runtime-библиотеки. Компилятор в образ не кладём (у hdbscan есть amd64 wheel).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./

# CPU torch отдельным слоем — дальше зависимости переиспользуют эти колёса.
RUN pip install --no-cache-dir --retries 10 \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Заглушка пакета, чтобы зависимости установились до копирования кода.
RUN mkdir -p services/detecting \
    && printf '"""detecting service"""\n' > services/detecting/__init__.py

RUN pip install --no-cache-dir --retries 10 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -e ".[detecting]"

COPY services/detecting ./services/detecting

CMD ["sh", "-c", "uvicorn detecting.api.app:app --host 0.0.0.0 --port ${DETECTING_PORT:-8000}"]
