FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY services/planning ./services/planning

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        default-jre-headless \
        libgomp1 \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -e ".[planning]" \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1
ENV PLANNING_DATA_DIR=/data
ENV PLANNING_CACHE_DIR=/cache
ENV JAVA_HOME=/usr/lib/jvm/default-java

CMD ["sh", "-c", "uvicorn planning.api.app:app --host 0.0.0.0 --port ${PLANNING_PORT:-8001}"]
