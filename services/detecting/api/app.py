import logging
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from detecting.log import configure_logging, get_logger
from detecting.settings import get_settings

from .queue import JobQueue
from .routes import router
from .runner import ModelRegistry
from .store import JobStore

logger = get_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(getattr(logging, settings.log_level.upper(), logging.INFO))
    client = redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        decode_responses=True,
    )
    store = JobStore(client, settings.job_ttl_seconds)
    store.ping()
    registry = ModelRegistry()
    queue = JobQueue(store, settings, registry)
    app.state.settings = settings
    app.state.store = store
    app.state.queue = queue
    app.state.redis = client
    await queue.start()
    logger.info(
        "detecting API: port=%s data_dir=%s max_jobs=%s",
        settings.port,
        settings.data_dir,
        settings.max_concurrent_jobs,
    )
    try:
        yield
    finally:
        await queue.stop()
        client.close()


app = FastAPI(title="detecting", lifespan=lifespan)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc.errors())})
