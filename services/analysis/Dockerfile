FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY pyproject.toml README.md ./

# Заглушка пакета, чтобы зависимости установились до копирования кода.
RUN mkdir -p services/analysis \
    && printf '"""analysis service"""\n' > services/analysis/__init__.py

RUN pip install --no-cache-dir --retries 5 -e ".[analysis]"

COPY services/analysis ./services/analysis

CMD ["sh", "-c", "uvicorn analysis.api.app:app --host 0.0.0.0 --port ${ANALYSIS_PORT:-8002}"]
