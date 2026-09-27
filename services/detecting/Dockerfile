FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY services/detecting ./services/detecting

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3-dev \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -e ".[detecting]" \
    && apt-get purge -y build-essential python3-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1
ENV DETECTING_DATA_DIR=/data
ENV DETECTING_WEIGHTS_DIR=/weights
ENV DETECTING_CACHE_DIR=/cache

CMD ["sh", "-c", "uvicorn detecting.api.app:app --host 0.0.0.0 --port ${DETECTING_PORT:-8000}"]
