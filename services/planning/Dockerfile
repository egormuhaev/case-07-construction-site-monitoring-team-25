FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLANNING_DATA_DIR=/data \
    PLANNING_CACHE_DIR=/cache \
    HF_HOME=/cache \
    HF_HUB_CACHE=/cache \
    JAVA_HOME=/usr/lib/jvm/default-java

# Системные пакеты и torch — до копирования кода, чтобы кеш не сбрасывался.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        default-jre-headless \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./

RUN pip install --no-cache-dir --retries 10 \
    torch \
    --index-url https://download.pytorch.org/whl/cpu

COPY services/planning ./services/planning

RUN pip install --no-cache-dir --retries 10 -e ".[planning]"

CMD ["sh", "-c", "uvicorn planning.api.app:app --host 0.0.0.0 --port ${PLANNING_PORT:-8001}"]
