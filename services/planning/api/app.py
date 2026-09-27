import logging
import os
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from planning.settings import get_settings

from .queue import JobQueue
from .routes import router
from .runner import ModelRegistry
from .store import JobStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    os.environ.setdefault("HF_HOME", str(settings.cache_dir))
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
    client = redis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        decode_responses=True,
    )
    store = JobStore(client, settings.job_ttl_seconds)
    store.ping()
    queue = JobQueue(store, settings, ModelRegistry())
    app.state.settings = settings
    app.state.store = store
    app.state.queue = queue
    await queue.start()
    try:
        yield
    finally:
        await queue.stop()
        client.close()


app = FastAPI(title="planning", lifespan=lifespan)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc.errors())})
